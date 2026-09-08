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
import { formatYmKey } from "@/lib/fiscal-year";
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

/** 担当者名 → 年月（YYYY-MM）→ その月の件数 */
export type ApoMonthlyAgg = Map<string, Map<string, ApoAggItem>>;

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

/**
 * アポキャンか。判定するのは @pocket の**商談ステータス**の値。
 * 部分一致なので「アポキャン（顧客都合）」なども除外する。
 */
function isApoCancelStatus(statusVal: string): boolean {
  return normalizeStatus(statusVal).includes("アポキャン");
}

/** 読めなかった日付の生値を残す件数。原因の切り分けに要る分だけ */
const DATE_SAMPLE_LIMIT = 2;
/** 生値が長くても記録は頭だけにする */
const DATE_SAMPLE_MAX_LENGTH = 40;
/** 月別の内訳を残す範囲。古い月まで全部出すとログが読めなくなる */
const COUNTED_BY_YM_LIMIT = 24;

/**
 * どの条件で何件落ちたかを残す。**氏名・顧客名は出さない**（件数のみ）。
 *
 * 全件が落ちて「対象期間のデータがありません」になったとき、絞り込みの
 * どの段で落ちたのかが分からないと切り分けられない。PT目標の
 * warnMissingSalesTargets と同じで、件数だけを JSON で1行に残す。
 *
 * total は取得件数そのもの。内訳の合計が total に足りないときは
 * record が object でない行が混ざっている（@pocket 側の異常）。
 *
 * dateSamples は読めなかった日付の生値。日付列に個人情報は入らないので
 * 出せる。形式の食い違い（「2026年9月8日」等）はこれで一目で分かる。
 *
 * ■ 月別集計に変えたことによる変更
 * 対象月の外を捨てなくなったので outOfPeriod は無くなった。代わりに
 * counted が何月に散ったかを countedByYm（新しい順に最大24ヶ月）で残す。
 * 特定の月だけ 0 なら、その月の入力漏れか日付の形式違いだと分かる。
 */
type ApoAggregateCounts = {
  total: number;
  noName: number;
  excludedName: number;
  typeEmpty: number;
  typeMismatch: number;
  excludedLabel: number;
  dateUnparsed: number;
  cancelled: number;
  counted: number;
};

function logApoAggregateCounts(
  counts: ApoAggregateCounts,
  countedByYm: Map<string, number>,
  dateSamples: string[],
): void {
  const recent = [...countedByYm.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, COUNTED_BY_YM_LIMIT);

  console.info(
    "[sales-dashboard] アポ件数の集計内訳",
    JSON.stringify({
      ...counts,
      months: countedByYm.size,
      countedByYm: Object.fromEntries(recent),
      ...(dateSamples.length ? { dateSamples } : {}),
    }),
  );
}

/**
 * ranking_pt_dashboard.js aggregateApo() 相当（アポ件数＝キャンセル以外）。
 *
 * **対象月では絞らない。** 全レコードを担当者ごと・年月ごとに積む。
 * 取得は元から日付で絞っていないので、こうしても @pocket への
 * 問い合わせは増えず、過去月も年間累計も同じ1回の取得から作れる。
 * 月を選ぶのは pickApoMonth / sumApoMonths を呼ぶ側の仕事。
 */
export function aggregateApoRecords(
  records: Array<{ record?: unknown }>,
  fieldMap: ApoDashboardFieldMap,
  filterValues: string[],
): ApoMonthlyAgg {
  const m: ApoMonthlyAgg = new Map();

  /** 絞り込みの条件・順序は変えていない。落ちた段を数えているだけ */
  const counts: ApoAggregateCounts = {
    total: records.length,
    noName: 0,
    excludedName: 0,
    typeEmpty: 0,
    typeMismatch: 0,
    excludedLabel: 0,
    dateUnparsed: 0,
    cancelled: 0,
    counted: 0,
  };
  const dateSamples: string[] = [];
  const countedByYm = new Map<string, number>();

  for (const row of records) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const recObj = rec as Record<string, unknown>;

    const name = normApClStaffName(
      readCustomerInfoFieldValue(recObj, fieldMap.salesperson),
    );
    if (!name) {
      counts.noName += 1;
      continue;
    }
    if (isExcludedSalesDashboardRankingName(name)) {
      counts.excludedName += 1;
      continue;
    }

    const typeVal = readCustomerInfoFieldValue(recObj, fieldMap.apoType);
    if (!typeVal) {
      counts.typeEmpty += 1;
      continue;
    }
    if (!isApoTypeMatched(typeVal, filterValues)) {
      counts.typeMismatch += 1;
      continue;
    }
    if (isExcludedSalesDashboardCaseLabel(typeVal)) {
      counts.excludedLabel += 1;
      continue;
    }

    const ym = parseRecordYmFromField(recObj, fieldMap.date);
    if (!ym) {
      counts.dateUnparsed += 1;
      if (dateSamples.length < DATE_SAMPLE_LIMIT) {
        const raw = readCustomerInfoFieldValue(recObj, fieldMap.date);
        if (raw) dateSamples.push(raw.slice(0, DATE_SAMPLE_MAX_LENGTH));
      }
      continue;
    }

    if (fieldMap.negotiationStatus) {
      const statusVal = readCustomerInfoFieldValue(
        recObj,
        fieldMap.negotiationStatus,
      );
      if (isApoCancelStatus(statusVal)) {
        counts.cancelled += 1;
        continue;
      }
    }

    const ymKey = formatYmKey(ym.year, ym.month1);
    counts.counted += 1;
    countedByYm.set(ymKey, (countedByYm.get(ymKey) ?? 0) + 1);

    let byMonth = m.get(name);
    if (!byMonth) {
      byMonth = new Map();
      m.set(name, byMonth);
    }
    const cur = byMonth.get(ymKey) ?? { name, apoCount: 0 };
    cur.apoCount += 1;
    byMonth.set(ymKey, cur);
  }

  logApoAggregateCounts(counts, countedByYm, dateSamples);

  return m;
}

/** 1ヶ月ぶんを取り出す。件数0の担当者は含めない */
export function pickApoMonth(
  byStaffMonth: ApoMonthlyAgg,
  ymKey: string,
): ApoAggItem[] {
  const out: ApoAggItem[] = [];
  byStaffMonth.forEach((byMonth, name) => {
    const hit = byMonth.get(ymKey);
    if (hit && hit.apoCount > 0) out.push({ name, apoCount: hit.apoCount });
  });
  return out;
}

/** 複数月を足す（年度の累計に使う）。件数0の担当者は含めない */
export function sumApoMonths(
  byStaffMonth: ApoMonthlyAgg,
  ymKeys: readonly string[],
): ApoAggItem[] {
  const out: ApoAggItem[] = [];
  byStaffMonth.forEach((byMonth, name) => {
    let apoCount = 0;
    for (const ymKey of ymKeys) {
      apoCount += byMonth.get(ymKey)?.apoCount ?? 0;
    }
    if (apoCount > 0) out.push({ name, apoCount });
  });
  return out;
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

/**
 * 単体でアポ件数だけを組み立てる経路（画面からは使っていない）。
 * 月別集計に合わせ、対象は年月キー（YYYY-MM）で受ける。
 */
export async function buildApoDashboardSection(
  boundStaffName: string,
  ymKey: string,
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
      fieldMap.negotiationStatus,
    ]
      .filter(Boolean)
      .join(",");

    const records = await fetchAllPages(apoAppId, wanted, listAuth);
    const byStaffMonth = aggregateApoRecords(records, fieldMap, filterValues);
    const sorted = sortApoAgg(pickApoMonth(byStaffMonth, ymKey));
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
