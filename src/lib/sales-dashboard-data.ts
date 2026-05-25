import "server-only";

import {
  customerInfoAppId,
  customerInfoConfigReady,
  customerInfoNameFieldId,
  customerInfoPocketAuth,
} from "@/lib/customer-info-config";
import {
  matchCustomerInfoPendingAudience,
  readStaffAssigneeName,
  resolveCustomerInfoCreatorFieldId,
} from "@/lib/customer-info-creator-field";
import { resolveCustomerInfoFormFieldId } from "@/lib/customer-info-form/resolve-fields";
import { readCustomerInfoFieldValue } from "@/lib/customer-info-record";
import type { StaffDashboardViewMode } from "@/lib/staff-dashboard-role";
import type { AtPocketFieldRow } from "@/lib/atpocket";
import { fetchAppFields, fetchRecordsList } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";

const PAGE_LIMIT = 1000;
const DEFAULT_MAX_PAGES = 25;
const STAFF_RANKING_TOP = 5;

export type SalesDashboardKpi = {
  salesAmount: number;
  contractCount: number;
  avgAmount: number;
};

export type SalesDashboardRankingRow = {
  rank: number;
  staffName: string;
  displayName: string;
  salesAmount: number;
  contractCount: number;
  isSelf: boolean;
};

export type SalesDashboardPayload = {
  viewMode: StaffDashboardViewMode;
  roleLabel: string;
  staffName: string;
  periodLabel: string;
  kpi: SalesDashboardKpi;
  ranking: SalesDashboardRankingRow[];
  rankingLimited: boolean;
};

function dashboardMaxPages(): number {
  const raw = process.env.SALES_DASHBOARD_MAX_PAGES?.trim();
  const n = raw ? Number(raw) : DEFAULT_MAX_PAGES;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_PAGES;
  return Math.min(50, Math.floor(n));
}

function currentYmJst(): { year: number; month1: number; label: string } {
  const d = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }),
  );
  const year = d.getFullYear();
  const month1 = d.getMonth() + 1;
  return { year, month1, label: `${year}年${month1}月` };
}

function parseYenAmount(raw: string): number {
  const digits = raw.replace(/[^\d]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function isContractInMonth(
  raw: string,
  year: number,
  month1: number,
): boolean {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 6) return false;
  const y = Number(digits.slice(0, 4));
  const m = Number(digits.slice(4, 6));
  return y === year && m === month1;
}

type SalesFieldIds = {
  nameField: string;
  apFieldId: string | null;
  clFieldId: string | null;
  creatorFieldId: string | null;
  contractAmountFieldId: string | null;
  contractDateFieldId: string | null;
};

function buildSalesFieldIds(appFields: AtPocketFieldRow[]): SalesFieldIds | null {
  const nameField = resolveConfiguredFieldToSchemaUniqueId(
    customerInfoNameFieldId()!,
    appFields,
  );
  if (!nameField) return null;

  const contractAmountFieldId = resolveCustomerInfoFormFieldId(
    "contractAmount",
    "契約金額",
    appFields,
  );
  const contractDateFieldId =
    resolveCustomerInfoFormFieldId("contractDate", "契約日", appFields) ??
    resolveCustomerInfoFormFieldId(
      "firstContractDate",
      "初回契約日",
      appFields,
    );

  return {
    nameField,
    apFieldId: resolveCustomerInfoFormFieldId("apStaff", "AP担当者", appFields),
    clFieldId: resolveCustomerInfoFormFieldId("clStaff", "CL担当者", appFields),
    creatorFieldId: resolveCustomerInfoCreatorFieldId(appFields),
    contractAmountFieldId,
    contractDateFieldId,
  };
}

function primaryStaffForRecord(
  recObj: Record<string, unknown>,
  ids: SalesFieldIds,
): string {
  const ap = readStaffAssigneeName(recObj, ids.apFieldId);
  if (ap) return ap;
  const cl = readStaffAssigneeName(recObj, ids.clFieldId);
  if (cl) return cl;
  const creator = readStaffAssigneeName(recObj, ids.creatorFieldId);
  return creator;
}

function recordBelongsToStaff(
  recObj: Record<string, unknown>,
  staffName: string,
  ids: SalesFieldIds,
): boolean {
  return (
    matchCustomerInfoPendingAudience(
      recObj,
      staffName,
      ids.apFieldId,
      ids.clFieldId,
      ids.creatorFieldId,
    ) !== null
  );
}

function maskStaffName(name: string): string {
  const n = normApClStaffName(name);
  if (!n) return "—";
  if (n.length <= 1) return "＊";
  return `${n.slice(0, 1)}＊＊`;
}

export async function buildSalesDashboardPayload(
  boundStaffName: string,
  viewMode: StaffDashboardViewMode,
  roleLabel: string,
): Promise<SalesDashboardPayload | null> {
  const cfg = customerInfoConfigReady();
  if (!cfg.ok) return null;

  const appId = customerInfoAppId();
  if (!appId) return null;

  const auth = customerInfoPocketAuth();
  const appFields = await fetchAppFields(appId, auth, {
    operation: "sales-dashboard",
    appEnv: "CUSTOMER_INFO_APP_ID",
  });
  const ids = buildSalesFieldIds(appFields);
  if (!ids) return null;

  const { year, month1, label: periodLabel } = currentYmJst();
  const bound = normApClStaffName(boundStaffName);

  const fieldIdSet = new Set<string>([ids.nameField]);
  if (ids.apFieldId) fieldIdSet.add(ids.apFieldId);
  if (ids.clFieldId) fieldIdSet.add(ids.clFieldId);
  if (ids.creatorFieldId) fieldIdSet.add(ids.creatorFieldId);
  if (ids.contractAmountFieldId) fieldIdSet.add(ids.contractAmountFieldId);
  if (ids.contractDateFieldId) fieldIdSet.add(ids.contractDateFieldId);
  const fieldsCsv = [...fieldIdSet].join(",");

  type Agg = { salesAmount: number; contractCount: number };
  const byStaff = new Map<string, Agg>();
  let personalSales = 0;
  let personalCount = 0;

  const maxPages = dashboardMaxPages();
  for (let page = 1; page <= maxPages; page++) {
    const data = await fetchRecordsList(
      appId,
      { limit: String(PAGE_LIMIT), page: String(page), fields: fieldsCsv },
      auth,
      { operation: "sales-dashboard:records", appEnv: "CUSTOMER_INFO_APP_ID" },
    );
    const rows = data.records ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const rec = row.record;
      if (!rec || typeof rec !== "object") continue;
      const recObj = rec as Record<string, unknown>;

      const dateRaw = ids.contractDateFieldId
        ? readCustomerInfoFieldValue(recObj, ids.contractDateFieldId)
        : "";
      if (!isContractInMonth(dateRaw, year, month1)) continue;

      const amount = ids.contractAmountFieldId
        ? parseYenAmount(
            readCustomerInfoFieldValue(recObj, ids.contractAmountFieldId),
          )
        : 0;
      if (amount <= 0) continue;

      const owner = primaryStaffForRecord(recObj, ids);
      if (!owner) continue;

      const cur = byStaff.get(owner) ?? { salesAmount: 0, contractCount: 0 };
      cur.salesAmount += amount;
      cur.contractCount += 1;
      byStaff.set(owner, cur);

      if (recordBelongsToStaff(recObj, bound, ids)) {
        personalSales += amount;
        personalCount += 1;
      }
    }

    if (rows.length < PAGE_LIMIT) break;
  }

  const rankingAll = [...byStaff.entries()]
    .sort((a, b) => b[1].salesAmount - a[1].salesAmount)
    .map(([staffName, agg], i) => ({
      rank: i + 1,
      staffName,
      salesAmount: agg.salesAmount,
      contractCount: agg.contractCount,
    }));

  const companySales = rankingAll.reduce((s, r) => s + r.salesAmount, 0);
  const companyCount = rankingAll.reduce((s, r) => s + r.contractCount, 0);

  const kpi: SalesDashboardKpi =
    viewMode === "manager"
      ? {
          salesAmount: companySales,
          contractCount: companyCount,
          avgAmount:
            companyCount > 0 ? Math.round(companySales / companyCount) : 0,
        }
      : {
          salesAmount: personalSales,
          contractCount: personalCount,
          avgAmount:
            personalCount > 0
              ? Math.round(personalSales / personalCount)
              : 0,
        };

  const rankingLimited = viewMode === "staff";
  const rankingSource = rankingLimited
    ? rankingAll.filter(
        (r) =>
          normApClStaffName(r.staffName) === bound ||
          r.rank <= STAFF_RANKING_TOP,
      )
    : rankingAll;

  const ranking: SalesDashboardRankingRow[] = rankingSource.map((r) => {
    const isSelf = normApClStaffName(r.staffName) === bound;
    const displayName =
      viewMode === "manager" || isSelf
        ? r.staffName
        : maskStaffName(r.staffName);
    return {
      rank: r.rank,
      staffName: r.staffName,
      displayName,
      salesAmount: r.salesAmount,
      contractCount: r.contractCount,
      isSelf,
    };
  });

  return {
    viewMode,
    roleLabel,
    staffName: boundStaffName,
    periodLabel,
    kpi,
    ranking,
    rankingLimited,
  };
}
