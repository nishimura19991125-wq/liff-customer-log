import "server-only";
import { safePocketErrorText } from "@/lib/api-error-response";

import {
  apiKeyForSalesDashboardApoPocket,
  apiKeyForSalesDashboardApoPocket1,
  fetchAppFields,
  fetchRecordsList,
  type AtPocketFetchAuth,
} from "@/lib/atpocket";
import { readCustomerInfoFieldValue } from "@/lib/customer-info-record";
import {
  parseSalesDashboardRecordYmFromField,
} from "@/lib/sales-dashboard-record-date";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import {
  isYmInPeriod,
  resolveSalesDashboardPeriod,
  type SalesDashboardPeriodKey,
} from "@/lib/sales-dashboard-period";
import {
  resolveApoDashboardFieldMap,
  salesDashboardApoAppId,
  salesDashboardApoTypeFilterValues,
  type ApoDashboardFieldMap,
} from "@/lib/sales-dashboard-fields";
import {
  isExcludedSalesDashboardCaseLabel,
  isExcludedSalesDashboardRankingName,
} from "@/lib/sales-dashboard-ranking-exclude";

const PAGE_LIMIT = 1000;
const DEFAULT_MAX_PAGES = 25;

export type ApoAggItem = {
  name: string;
  apoCount: number;
};

export type ApoDashboardKpi = {
  totalApoCount: number;
};

export type ApoDashboardRankingRow = {
  rank: number;
  staffName: string;
  apoCount: number;
  sharePercent: number;
  isSelf: boolean;
  isPodium: boolean;
};

function dashboardMaxPages(): number {
  const raw = process.env.SALES_DASHBOARD_MAX_PAGES?.trim();
  const n = raw ? Number(raw) : DEFAULT_MAX_PAGES;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_PAGES;
  return Math.min(50, Math.floor(n));
}

/** @deprecated parseSalesDashboardRecordYmFromField を使用 */
export const parseRecordYmFromField = parseSalesDashboardRecordYmFromField;

function normalizeStatus(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\(/g, "（")
    .replace(/\)/g, "）")
    .trim();
}

function isApoTypeMatched(typeVal: string, filterValues: string[]): boolean {
  const tv = typeVal.trim();
  if (!tv) return false;
  if (!filterValues.length) return true;
  return filterValues.some((fv) => tv.includes(fv));
}

function isApoCancelStatus(statusVal: string): boolean {
  return normalizeStatus(statusVal).includes("アポキャン");
}

/** ranking_pt_dashboard.js aggregateApo() 相当（アポ件数＝キャンセル以外） */
export function aggregateApoRecords(
  records: Array<{ record?: unknown }>,
  fieldMap: ApoDashboardFieldMap,
  periodKey: SalesDashboardPeriodKey,
  filterValues: string[],
): Map<string, ApoAggItem> {
  const period = resolveSalesDashboardPeriod(periodKey);
  const m = new Map<string, ApoAggItem>();

  for (const row of records) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const recObj = rec as Record<string, unknown>;

    const name = normApClStaffName(
      readCustomerInfoFieldValue(recObj, fieldMap.salesperson),
    );
    if (!name || isExcludedSalesDashboardRankingName(name)) continue;

    const typeVal = readCustomerInfoFieldValue(recObj, fieldMap.apoType);
    if (!typeVal || !isApoTypeMatched(typeVal, filterValues)) continue;
    if (isExcludedSalesDashboardCaseLabel(typeVal)) continue;

    const ym = parseRecordYmFromField(recObj, fieldMap.date);
    if (!ym || !isYmInPeriod(ym.year, ym.month1, period)) continue;

    if (fieldMap.estimateStatus) {
      const statusVal = readCustomerInfoFieldValue(
        recObj,
        fieldMap.estimateStatus,
      );
      if (isApoCancelStatus(statusVal)) continue;
    }

    const cur = m.get(name) ?? { name, apoCount: 0 };
    cur.apoCount += 1;
    m.set(name, cur);
  }

  return m;
}

export function sortApoAgg(items: ApoAggItem[]): ApoAggItem[] {
  const visible = items.filter(
    (it) => !isExcludedSalesDashboardRankingName(it.name),
  );
  return [...visible].sort(
    (a, b) =>
      b.apoCount - a.apoCount || a.name.localeCompare(b.name, "ja"),
  );
}

export function buildApoRanking(
  sorted: ApoAggItem[],
  totalApo: number,
  bound: string,
): ApoDashboardRankingRow[] {
  return sorted.map((item, i) => ({
    rank: i + 1,
    staffName: item.name,
    apoCount: item.apoCount,
    sharePercent:
      totalApo > 0 ? Math.round((item.apoCount / totalApo) * 1000) / 10 : 0,
    isSelf: normApClStaffName(item.name) === bound,
    isPodium: i < 3,
  }));
}

async function fetchAllPages(
  appId: string,
  fieldsCsv: string,
  auth: AtPocketFetchAuth,
): Promise<Array<{ record?: unknown }>> {
  const all: Array<{ record?: unknown }> = [];
  const maxPages = dashboardMaxPages();

  for (let page = 1; page <= maxPages; page++) {
    const data = await fetchRecordsList(
      appId,
      { limit: String(PAGE_LIMIT), page: String(page), fields: fieldsCsv },
      auth,
      {
        operation: "sales-dashboard:apo-records",
        appEnv: "SALES_DASHBOARD_APO_APP_ID",
      },
    );
    const rows = data.records ?? [];
    all.push(...rows);
    if (rows.length < PAGE_LIMIT) break;
  }
  return all;
}

export type ApoDashboardSectionResult =
  | {
      ok: true;
      kpi: ApoDashboardKpi;
      ranking: ApoDashboardRankingRow[];
    }
  | { ok: false; error: string };

export async function buildApoDashboardSection(
  boundStaffName: string,
  periodKey: SalesDashboardPeriodKey,
): Promise<ApoDashboardSectionResult> {
  const apoAppId = salesDashboardApoAppId();
  if (!apoAppId) {
    return {
      ok: false,
      error: "SALES_DASHBOARD_APO_APP_ID が未設定です",
    };
  }

  try {
    const fieldAuth = { apiKey: apiKeyForSalesDashboardApoPocket() };
    const listAuth = { apiKey: apiKeyForSalesDashboardApoPocket1() };
    const bound = normApClStaffName(boundStaffName);
    const filterValues = salesDashboardApoTypeFilterValues();

    const apoFields = await fetchAppFields(apoAppId, fieldAuth, {
      operation: "sales-dashboard:apo-fields",
      appEnv: "SALES_DASHBOARD_APO_APP_ID",
    });
    const fieldMap = resolveApoDashboardFieldMap(apoFields);
    if (!fieldMap) {
      return {
        ok: false,
        error:
          "必須フィールド（AP担当者・アポ種別・日付）の特定に失敗しました。SALES_DASHBOARD_APO_*_FIELD_ID で uniqueId を指定してください",
      };
    }

    const wanted = [
      fieldMap.salesperson,
      fieldMap.apoType,
      fieldMap.date,
      fieldMap.estimateStatus,
    ]
      .filter(Boolean)
      .join(",");

    const records = await fetchAllPages(apoAppId, wanted, listAuth);
    const byStaff = aggregateApoRecords(
      records,
      fieldMap,
      periodKey,
      filterValues,
    );
    const sorted = sortApoAgg([...byStaff.values()]);
    const totalApo = sorted.reduce((s, x) => s + x.apoCount, 0);

    return {
      ok: true,
      kpi: { totalApoCount: totalApo },
      ranking: buildApoRanking(sorted, totalApo, bound),
    };
  } catch (e) {
    return {
      ok: false,
      // 生メッセージは safePocketErrorText の中でログへ残す
      error: safePocketErrorText(e, {
        scope: "sales-dashboard:apo",
        message: "アポ件数ランキングの取得に失敗しました",
      }),
    };
  }
}
