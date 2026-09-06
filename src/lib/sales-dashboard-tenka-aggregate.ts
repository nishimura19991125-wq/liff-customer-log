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
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import {
  parseRecordYmFromField,
  type ApoDashboardRankingRow,
} from "@/lib/sales-dashboard-apo-aggregate";
import {
  isYmInPeriod,
  resolveSalesDashboardPeriod,
  type SalesDashboardPeriodKey,
} from "@/lib/sales-dashboard-period";
import {
  resolveApoTenkaFieldMap,
  salesDashboardApoAppId,
  salesDashboardApoTenkaTypeFilterValues,
  type ApoTenkaFieldMap,
} from "@/lib/sales-dashboard-fields";
import { isExcludedSalesDashboardRankingName } from "@/lib/sales-dashboard-ranking-exclude";

export type { ApoDashboardRankingRow as TenkaDashboardRankingRow };

export type TenkaDashboardKpi = {
  totalTargetCount: number;
};

const PAGE_LIMIT = 1000;
const DEFAULT_MAX_PAGES = 25;
const TENKA_CLOSE_TYPE = "両クロ";
const TENKA_MEETING_PLACE = "宅内テーブル商談";
const TENKA_MAX_LEAD_TIME_DAYS = 14;

function dashboardMaxPages(): number {
  const raw = process.env.SALES_DASHBOARD_MAX_PAGES?.trim();
  const n = raw ? Number(raw) : DEFAULT_MAX_PAGES;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_PAGES;
  return Math.min(50, Math.floor(n));
}

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

function parseLeadTimeDays(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

function isApoTypeMatched(typeVal: string, filterValues: string[]): boolean {
  const tv = typeVal.trim();
  if (!tv) return false;
  if (!filterValues.length) return true;
  return filterValues.some((fv) => tv.includes(fv));
}

/** ranking_pt_dashboard.js AP天下賞のレコード判定 */
export function aggregateTenkaRecords(
  records: Array<{ record?: unknown }>,
  fieldMap: ApoTenkaFieldMap,
  periodKey: SalesDashboardPeriodKey,
  filterValues: string[],
): Map<string, { name: string; targetCount: number }> {
  const period = resolveSalesDashboardPeriod(periodKey);
  const m = new Map<string, { name: string; targetCount: number }>();

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

    const closeType = nfkc(readCustomerInfoFieldValue(recObj, fieldMap.closeType));
    if (closeType !== TENKA_CLOSE_TYPE) continue;

    const meetingPlace = nfkc(
      readCustomerInfoFieldValue(recObj, fieldMap.meetingPlace),
    );
    if (meetingPlace !== TENKA_MEETING_PLACE) continue;

    const leadRaw = readCustomerInfoFieldValue(recObj, fieldMap.leadTime);
    if (!leadRaw) continue;
    const leadDays = parseLeadTimeDays(leadRaw);
    if (leadDays === null || leadDays > TENKA_MAX_LEAD_TIME_DAYS) continue;

    const ym = parseRecordYmFromField(recObj, fieldMap.date);
    if (!ym || !isYmInPeriod(ym.year, ym.month1, period)) continue;

    const cur = m.get(name) ?? { name, targetCount: 0 };
    cur.targetCount += 1;
    m.set(name, cur);
  }

  return m;
}

function buildTenkaRanking(
  sorted: Array<{ name: string; targetCount: number }>,
  total: number,
  bound: string,
): ApoDashboardRankingRow[] {
  return sorted.map((item, i) => ({
    rank: i + 1,
    staffName: item.name,
    apoCount: item.targetCount,
    sharePercent:
      total > 0 ? Math.round((item.targetCount / total) * 1000) / 10 : 0,
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
        operation: "sales-dashboard:tenka-records",
        appEnv: "SALES_DASHBOARD_APO_APP_ID",
      },
    );
    const rows = data.records ?? [];
    all.push(...rows);
    if (rows.length < PAGE_LIMIT) break;
  }
  return all;
}

export type TenkaDashboardSectionResult =
  | {
      ok: true;
      kpi: TenkaDashboardKpi;
      ranking: ApoDashboardRankingRow[];
    }
  | { ok: false; error: string };

export async function buildTenkaDashboardSection(
  boundStaffName: string,
  periodKey: SalesDashboardPeriodKey,
): Promise<TenkaDashboardSectionResult> {
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
    const filterValues = salesDashboardApoTenkaTypeFilterValues();

    const apoFields = await fetchAppFields(apoAppId, fieldAuth, {
      operation: "sales-dashboard:tenka-fields",
      appEnv: "SALES_DASHBOARD_APO_APP_ID",
    });
    const fieldMap = resolveApoTenkaFieldMap(apoFields);
    if (!fieldMap) {
      return {
        ok: false,
        error:
          "AP天下賞の必須フィールド（AP担当者・アポ種別・日付・片クロor両クロ・商談場所・商談化リードタイム）の特定に失敗しました",
      };
    }

    const wanted = [
      fieldMap.salesperson,
      fieldMap.apoType,
      fieldMap.date,
      fieldMap.closeType,
      fieldMap.meetingPlace,
      fieldMap.leadTime,
      fieldMap.estimateStatus,
    ]
      .filter(Boolean)
      .join(",");

    const records = await fetchAllPages(apoAppId, wanted, listAuth);
    const byStaff = aggregateTenkaRecords(
      records,
      fieldMap,
      periodKey,
      filterValues,
    );
    const sorted = [...byStaff.values()].sort(
      (a, b) =>
        b.targetCount - a.targetCount || a.name.localeCompare(b.name, "ja"),
    );
    const total = sorted.reduce((s, x) => s + x.targetCount, 0);

    return {
      ok: true,
      kpi: { totalTargetCount: total },
      ranking: buildTenkaRanking(sorted, total, bound),
    };
  } catch (e) {
    return {
      ok: false,
      // 生メッセージは safePocketErrorText の中でログへ残す
      error: safePocketErrorText(e, {
        scope: "sales-dashboard:tenka",
        message: "AP天下賞ランキングの取得に失敗しました",
      }),
    };
  }
}
