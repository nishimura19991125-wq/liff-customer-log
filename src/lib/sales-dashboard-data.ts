import "server-only";

import { fetchAppFields } from "@/lib/atpocket";
import {
  customerInfoDashboardFieldAuth,
  customerInfoDashboardListAuths,
} from "@/lib/customer-info-config";
import { apiKeyForAppFields } from "@/lib/atpocket";
import { buildApoAndTenkaSections } from "@/lib/sales-dashboard-apo-tenka-bundle";
import {
  customerInfoListAuths,
  fetchSalesDashboardRecordPages,
  salesDashboardPtListAuths,
} from "@/lib/sales-dashboard-list-fetch";
import { readCustomerInfoFieldValue } from "@/lib/customer-info-record";
import { parseSalesDashboardRecordYmFromField } from "@/lib/sales-dashboard-record-date";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import {
  isYmInPeriod,
  resolveSalesDashboardPeriod,
  type SalesDashboardPeriodKey,
} from "@/lib/sales-dashboard-period";
import { isExcludedSalesDashboardRankingName } from "@/lib/sales-dashboard-ranking-exclude";
import type {
  ApoDashboardKpi,
  ApoDashboardRankingRow,
} from "@/lib/sales-dashboard-apo-aggregate";
import {
  resolveContractCountFieldMap,
  resolvePtDashboardFieldMap,
  salesDashboardContractAppId,
  salesDashboardApoAppId,
  salesDashboardPtAppId,
  type ContractCountFieldMap,
  type PtDashboardFieldMap,
} from "@/lib/sales-dashboard-fields";

export type { ApoDashboardKpi, ApoDashboardRankingRow };

export type SalesDashboardKpi = {
  pt: number;
  salesAmount: number;
  contractCount: number;
  avgAmount: number;
};

export type SalesDashboardRankingRow = {
  rank: number;
  staffName: string;
  pt: number;
  salesAmount: number;
  contractCount: number;
  sharePercent: number;
  isSelf: boolean;
  isPodium: boolean;
};

export type SalesDashboardPayload = {
  staffName: string;
  period: SalesDashboardPeriodKey;
  periodLabel: string;
  periodHint: string;
  kpi: SalesDashboardKpi;
  ranking: SalesDashboardRankingRow[];
  apoEnabled: boolean;
  apoReady: boolean;
  apoError: string | null;
  apoKpi: ApoDashboardKpi | null;
  apoRanking: ApoDashboardRankingRow[];
  tenkaReady: boolean;
  tenkaError: string | null;
  tenkaKpi: { totalTargetCount: number } | null;
  tenkaRanking: ApoDashboardRankingRow[];
  /** 429 時にサーバー共有キャッシュの古い集計を返したとき */
  rateLimited?: boolean;
  dashboardStale?: boolean;
};

type StaffAgg = {
  name: string;
  pt: number;
  salesAmount: number;
  contractCount: number;
};

function parseNumber(raw: string): number {
  const digits = raw.replace(/[^\d]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

function monthKeyFromYm(year: number, month1: number): string {
  return `${year}-${String(month1).padStart(2, "0")}`;
}

/** PT集計表: ranking_pt_dashboard.js aggregate() 相当 */
function aggregatePtRecords(
  records: Array<{ record?: unknown }>,
  fieldMap: PtDashboardFieldMap,
  periodKey: SalesDashboardPeriodKey,
): Map<string, StaffAgg> {
  const period = resolveSalesDashboardPeriod(periodKey);
  const m = new Map<string, StaffAgg>();

  for (const row of records) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const recObj = rec as Record<string, unknown>;

    const name = normApClStaffName(
      readCustomerInfoFieldValue(recObj, fieldMap.salesperson),
    );
    if (!name || isExcludedSalesDashboardRankingName(name)) continue;

    const ym = parseSalesDashboardRecordYmFromField(recObj, fieldMap.date);
    if (!ym || !isYmInPeriod(ym.year, ym.month1, period)) continue;

    const pt = fieldMap.pt
      ? parseNumber(readCustomerInfoFieldValue(recObj, fieldMap.pt))
      : 0;
    const salesRaw = fieldMap.sales
      ? readCustomerInfoFieldValue(recObj, fieldMap.sales)
      : "";
    const sales = fieldMap.sales && pt !== 0 ? parseNumber(salesRaw) : 0;

    const cur = m.get(name) ?? {
      name,
      pt: 0,
      salesAmount: 0,
      contractCount: 0,
    };
    cur.pt += pt;
    if (pt !== 0) cur.salesAmount += sales;
    m.set(name, cur);
  }

  return m;
}

/** 契約情報: buildContractCountMap + 対象月 */
function buildContractCountByMonth(
  records: Array<{ record?: unknown }>,
  fieldMap: ContractCountFieldMap,
): Map<string, Map<string, number>> {
  const map = new Map<string, Map<string, number>>();

  for (const row of records) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const recObj = rec as Record<string, unknown>;

    if (fieldMap.customerStatus) {
      const status = readCustomerInfoFieldValue(
        recObj,
        fieldMap.customerStatus,
      );
      if (status === "キャンセル") continue;
    }

    const name = normApClStaffName(
      readCustomerInfoFieldValue(recObj, fieldMap.clPerson),
    );
    if (!name || isExcludedSalesDashboardRankingName(name)) continue;

    const ym = parseSalesDashboardRecordYmFromField(recObj, fieldMap.date);
    if (!ym) continue;

    const monthKey = monthKeyFromYm(ym.year, ym.month1);
    let perPerson = map.get(name);
    if (!perPerson) {
      perPerson = new Map();
      map.set(name, perPerson);
    }
    perPerson.set(monthKey, (perPerson.get(monthKey) ?? 0) + 1);
  }

  return map;
}

function mergeContractCounts(
  byStaff: Map<string, StaffAgg>,
  contractMap: Map<string, Map<string, number>>,
  periodKey: SalesDashboardPeriodKey,
): void {
  const period = resolveSalesDashboardPeriod(periodKey);
  const monthKey = `${period.year}-${String(period.month1).padStart(2, "0")}`;

  contractMap.forEach((perMonth, name) => {
    const count = perMonth.get(monthKey) ?? 0;
    if (count <= 0) return;
    const cur = byStaff.get(name) ?? {
      name,
      pt: 0,
      salesAmount: 0,
      contractCount: 0,
    };
    cur.contractCount = count;
    byStaff.set(name, cur);
  });
}

function sortStaffAgg(items: StaffAgg[]): StaffAgg[] {
  const visible = items.filter(
    (it) => !isExcludedSalesDashboardRankingName(it.name),
  );
  return [...visible].sort(
    (a, b) =>
      b.pt - a.pt ||
      b.salesAmount - a.salesAmount ||
      b.contractCount - a.contractCount ||
      a.name.localeCompare(b.name, "ja"),
  );
}

function buildRanking(
  sorted: StaffAgg[],
  companyPt: number,
  bound: string,
): SalesDashboardRankingRow[] {
  return sorted.map((item, i) => ({
    rank: i + 1,
    staffName: item.name,
    pt: item.pt,
    salesAmount: item.salesAmount,
    contractCount: item.contractCount,
    sharePercent:
      companyPt > 0 ? Math.round((item.pt / companyPt) * 1000) / 10 : 0,
    isSelf: normApClStaffName(item.name) === bound,
    isPodium: i < 3,
  }));
}

export async function buildSalesDashboardPayload(
  boundStaffName: string,
  periodKey: SalesDashboardPeriodKey,
): Promise<SalesDashboardPayload | null> {
  const ptAppId = salesDashboardPtAppId();
  if (!ptAppId) return null;

  const ptFieldAuth = { apiKey: apiKeyForAppFields("SALES_DASHBOARD_PT") };
  const ptListAuths = salesDashboardPtListAuths();
  const contractFieldAuth = customerInfoDashboardFieldAuth();
  const contractListAuths = customerInfoDashboardListAuths();
  const period = resolveSalesDashboardPeriod(periodKey);
  const bound = normApClStaffName(boundStaffName);
  const contractAppId = salesDashboardContractAppId();

  const [
    apoTenka,
    ptFields,
    contractFields,
  ] = await Promise.all([
    buildApoAndTenkaSections(boundStaffName, periodKey),
    fetchAppFields(ptAppId, ptFieldAuth, {
      operation: "sales-dashboard:pt-fields",
      appEnv: "SALES_DASHBOARD_PT_APP_ID",
    }),
    contractAppId
      ? fetchAppFields(contractAppId, contractFieldAuth, {
          operation: "sales-dashboard:contract-fields",
          appEnv: "SALES_DASHBOARD_CONTRACT_APP_ID",
        }).catch((e) => {
          console.warn("[sales-dashboard] contract fields skipped", e);
          return null;
        })
      : Promise.resolve(null),
  ]);

  const apoSection = apoTenka.apo;
  const tenkaSection = apoTenka.tenka;

  const ptFieldMap = resolvePtDashboardFieldMap(ptFields);
  if (!ptFieldMap) return null;

  const ptWanted = [
    ptFieldMap.salesperson,
    ptFieldMap.date,
    ptFieldMap.pt,
    ptFieldMap.sales,
  ].filter(Boolean) as string[];

  const contractFieldMap = contractFields
    ? resolveContractCountFieldMap(contractFields)
    : null;
  const contractCsv = contractFieldMap
    ? [
        contractFieldMap.date,
        contractFieldMap.clPerson,
        contractFieldMap.customerStatus,
      ]
        .filter(Boolean)
        .join(",")
    : "";

  const [ptRecords, contractRecords] = await Promise.all([
    fetchSalesDashboardRecordPages(
      ptAppId,
      ptWanted.join(","),
      ptListAuths,
      {
        operation: "sales-dashboard:pt-records",
        appEnv: "SALES_DASHBOARD_PT_APP_ID",
      },
    ),
    contractAppId && contractCsv
      ? fetchSalesDashboardRecordPages(
          contractAppId,
          contractCsv,
          contractListAuths,
          {
            operation: "sales-dashboard:contract-records",
            appEnv: "SALES_DASHBOARD_CONTRACT_APP_ID",
          },
        ).catch((e) => {
          console.warn("[sales-dashboard] contract records skipped", e);
          return [] as Array<{ record?: unknown }>;
        })
      : Promise.resolve([] as Array<{ record?: unknown }>),
  ]);

  const byStaff = aggregatePtRecords(ptRecords, ptFieldMap, periodKey);

  if (contractFieldMap && contractRecords.length > 0) {
    const contractMap = buildContractCountByMonth(
      contractRecords,
      contractFieldMap,
    );
    mergeContractCounts(byStaff, contractMap, periodKey);
  }

  const sorted = sortStaffAgg([...byStaff.values()]);

  const companyPt = sorted.reduce((s, x) => s + x.pt, 0);
  const companySales = sorted.reduce((s, x) => s + x.salesAmount, 0);
  const companyCount = sorted.reduce((s, x) => s + x.contractCount, 0);

  const kpi: SalesDashboardKpi = {
    pt: companyPt,
    salesAmount: companySales,
    contractCount: companyCount,
    avgAmount:
      companyCount > 0
        ? Math.round(companySales / companyCount)
        : 0,
  };

  return {
    staffName: boundStaffName,
    period: periodKey,
    periodLabel: period.label,
    periodHint: period.hint,
    kpi,
    ranking: buildRanking(sorted, companyPt, bound),
    apoEnabled: Boolean(salesDashboardApoAppId()),
    apoReady: apoSection.ok,
    apoError: apoSection.ok ? null : apoSection.error,
    apoKpi: apoSection.ok ? apoSection.kpi : null,
    apoRanking: apoSection.ok ? apoSection.ranking : [],
    tenkaReady: tenkaSection.ok,
    tenkaError: tenkaSection.ok ? null : tenkaSection.error,
    tenkaKpi: tenkaSection.ok ? tenkaSection.kpi : null,
    tenkaRanking: tenkaSection.ok ? tenkaSection.ranking : [],
  };
}
