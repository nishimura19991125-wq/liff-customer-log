import "server-only";

import {
  apiKeyForSalesDashboardApoPocket,
  fetchAllRecordsPages,
  fetchAppFields,
  type AtPocketRecordRow,
} from "@/lib/atpocket";
import { readCustomerInfoFieldValue } from "@/lib/customer-info-record";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import {
  resolveApoDashboardFieldMap,
  resolvePtDashboardFieldMap,
  salesDashboardApoAppId,
  salesDashboardApoTypeFilterValues,
  salesDashboardPtAppId,
  type ApoDashboardFieldMap,
  type PtDashboardFieldMap,
} from "@/lib/sales-dashboard-fields";
import {
  fetchSalesDashboardRecordPages,
  salesDashboardApoListAuths,
  salesDashboardPtListAuths,
} from "@/lib/sales-dashboard-list-fetch";
import {
  isExcludedSalesDashboardCaseLabel,
  isExcludedSalesDashboardRankingName,
} from "@/lib/sales-dashboard-ranking-exclude";
import { parseSalesDashboardRecordYmFromField } from "@/lib/sales-dashboard-record-date";
import { apiKeyForAppFields } from "@/lib/atpocket";
import {
  aggregateSalesProgressByBranch,
  buildCompanySalesProgress,
  summarizeSalesProgressMatching,
  type SalesActualRow,
  type SalesProgressGroupRow,
  type SalesProgressMetrics,
  type SalesTargetRow,
} from "@/lib/sales-progress-aggregate";
import {
  resolveSalesProgressBranch,
  salesProgressBranchOrder,
} from "@/lib/sales-progress-branch";
import {
  isSalesProgressMonthMatch,
  type SalesProgressMonth,
} from "@/lib/sales-progress-period";
import {
  resolveSalesTargetFieldMap,
  salesProgressBranchConfig,
  salesTargetAppId,
} from "@/lib/sales-target-fields";

/**
 * 営業進捗の集計（タスクK）。
 *
 * 既存の /sales-dashboard と GET /api/sales-dashboard は変更していない。
 * 任意の月を選べるようにするため、既存の getOrComputeSalesDashboardCore は
 * 期間が "current" | "previous" 固定で再利用できず、取得と担当者別の集計を
 * ここに書いている。列の解決・レコード取得・除外判定・日付の解釈は既存の
 * エクスポートをそのまま呼び、突合の正規化も normApClStaffName を使う。
 *
 * ■ 個人データの扱い
 * ここが返す core には担当者別の行が入る。**サーバの中だけで使う**もので、
 * そのままクライアントへ返してはならない。呼び出し側（route）が本人分を
 * 取り出し、全社・支社別の集計値と一緒に返す。
 */

const TARGET_MAX_PAGES = 10;

/** 既存の aggregatePtRecords と同じ読み方（マイナス記号は落ちる） */
function parseNumber(raw: string): number {
  const digits = raw.replace(/[^\d]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 以下2つは sales-dashboard-apo-aggregate.ts の同名の関数と同じ判定。
 * 向こうはモジュール内で閉じていてエクスポートされていないため写している。
 * 既存ファイルは変更しない制約があるので、export を足す改変は行わない。
 */
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

type StaffTotals = Map<string, { pt: number; apoCount: number }>;

function addTo(
  map: StaffTotals,
  name: string,
  patch: { pt?: number; apoCount?: number },
): void {
  const cur = map.get(name) ?? { pt: 0, apoCount: 0 };
  cur.pt += patch.pt ?? 0;
  cur.apoCount += patch.apoCount ?? 0;
  map.set(name, cur);
}

/** 目標登録(月次)の対象月ぶん */
function collectTargets(
  records: AtPocketRecordRow[],
  fieldMap: ReturnType<typeof resolveSalesTargetFieldMap>,
  month: SalesProgressMonth,
  branchConfig: ReturnType<typeof salesProgressBranchConfig>,
): { rows: SalesTargetRow[]; rowsWithoutName: number; excludedRows: number } {
  const rows: SalesTargetRow[] = [];
  let rowsWithoutName = 0;
  let excludedRows = 0;
  if (!fieldMap) return { rows, rowsWithoutName, excludedRows };

  for (const row of records) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const recObj = rec as Record<string, unknown>;

    const ym = parseSalesDashboardRecordYmFromField(recObj, fieldMap.month);
    if (!isSalesProgressMonthMatch(ym, month)) continue;

    const name = normApClStaffName(
      readCustomerInfoFieldValue(recObj, fieldMap.staffName),
    );
    if (!name) {
      rowsWithoutName += 1;
      continue;
    }
    // 実績側と同じ除外を掛ける。片側だけ除外すると達成率が歪む
    if (isExcludedSalesDashboardRankingName(name)) {
      excludedRows += 1;
      continue;
    }

    rows.push({
      staffName: name,
      branch: resolveSalesProgressBranch(
        readCustomerInfoFieldValue(recObj, fieldMap.branch),
        branchConfig,
      ),
      apoCount: parseNumber(
        readCustomerInfoFieldValue(recObj, fieldMap.apoCount),
      ),
      pt: parseNumber(readCustomerInfoFieldValue(recObj, fieldMap.pt)),
    });
  }

  return { rows, rowsWithoutName, excludedRows };
}

/** PT集計表：既存の aggregatePtRecords と同じフィルタ・同じ parseNumber */
function collectPtActuals(
  records: AtPocketRecordRow[],
  fieldMap: PtDashboardFieldMap,
  month: SalesProgressMonth,
  into: StaffTotals,
): { rowsWithoutName: number } {
  let rowsWithoutName = 0;

  for (const row of records) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const recObj = rec as Record<string, unknown>;

    const name = normApClStaffName(
      readCustomerInfoFieldValue(recObj, fieldMap.salesperson),
    );
    if (!name) {
      rowsWithoutName += 1;
      continue;
    }
    if (isExcludedSalesDashboardRankingName(name)) continue;

    const ym = parseSalesDashboardRecordYmFromField(recObj, fieldMap.date);
    if (!isSalesProgressMonthMatch(ym, month)) continue;

    const pt = fieldMap.pt
      ? parseNumber(readCustomerInfoFieldValue(recObj, fieldMap.pt))
      : 0;
    addTo(into, name, { pt });
  }

  return { rowsWithoutName };
}

/** アポ取得情報：既存の aggregateApoRecords と同じフィルタ（アポキャン除外込み） */
function collectApoActuals(
  records: AtPocketRecordRow[],
  fieldMap: ApoDashboardFieldMap,
  month: SalesProgressMonth,
  filterValues: string[],
  into: StaffTotals,
): { rowsWithoutName: number } {
  let rowsWithoutName = 0;

  for (const row of records) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const recObj = rec as Record<string, unknown>;

    const name = normApClStaffName(
      readCustomerInfoFieldValue(recObj, fieldMap.salesperson),
    );
    if (!name) {
      rowsWithoutName += 1;
      continue;
    }
    if (isExcludedSalesDashboardRankingName(name)) continue;

    const typeVal = readCustomerInfoFieldValue(recObj, fieldMap.apoType);
    if (!typeVal || !isApoTypeMatched(typeVal, filterValues)) continue;
    if (isExcludedSalesDashboardCaseLabel(typeVal)) continue;

    const ym = parseSalesDashboardRecordYmFromField(recObj, fieldMap.date);
    if (!isSalesProgressMonthMatch(ym, month)) continue;

    if (fieldMap.estimateStatus) {
      const statusVal = readCustomerInfoFieldValue(
        recObj,
        fieldMap.estimateStatus,
      );
      if (isApoCancelStatus(statusVal)) continue;
    }

    addTo(into, name, { apoCount: 1 });
  }

  return { rowsWithoutName };
}

export type SalesProgressCore = {
  ym: string;
  monthLabel: string;
  company: SalesProgressMetrics;
  branches: SalesProgressGroupRow[];
  /**
   * 担当者別の目標・実績。**サーバ内でのみ使う**。
   * 本人分を取り出すために保持しており、クライアントへ返してはならない。
   */
  targets: SalesTargetRow[];
  actuals: SalesActualRow[];
  /** 目標が1件も取れなかった（列の解決失敗・未登録の月） */
  targetsAvailable: boolean;
};

export async function buildSalesProgressCore(
  month: SalesProgressMonth,
): Promise<SalesProgressCore | null> {
  const targetAppId = salesTargetAppId();
  const ptAppId = salesDashboardPtAppId();
  const apoAppId = salesDashboardApoAppId();
  if (!targetAppId || !ptAppId) return null;

  const branchConfig = salesProgressBranchConfig();

  // ── 列の解決 ──────────────────────────────────────
  const [targetFields, ptFields, apoFields] = await Promise.all([
    fetchAppFields(
      targetAppId,
      { apiKey: apiKeyForAppFields("SALES_TARGET") },
      {
        operation: "sales-progress:target-fields",
        appEnv: "SALES_TARGET_APP_ID",
      },
    ),
    fetchAppFields(
      ptAppId,
      { apiKey: apiKeyForAppFields("SALES_DASHBOARD_PT") },
      { operation: "sales-progress:pt-fields", appEnv: "SALES_DASHBOARD_PT_APP_ID" },
    ),
    apoAppId
      ? fetchAppFields(
          apoAppId,
          { apiKey: apiKeyForSalesDashboardApoPocket() },
          {
            operation: "sales-progress:apo-fields",
            appEnv: "SALES_DASHBOARD_APO_APP_ID",
          },
        ).catch((e) => {
          console.warn("[sales-progress] apo fields skipped", e);
          return null;
        })
      : Promise.resolve(null),
  ]);

  const targetFieldMap = resolveSalesTargetFieldMap(targetFields);
  const ptFieldMap = resolvePtDashboardFieldMap(ptFields);
  if (!targetFieldMap || !ptFieldMap) return null;
  const apoFieldMap = apoFields ? resolveApoDashboardFieldMap(apoFields) : null;

  // ── レコード取得 ──────────────────────────────────
  const targetCsv = [
    targetFieldMap.month,
    targetFieldMap.branch,
    targetFieldMap.staffName,
    targetFieldMap.apoCount,
    targetFieldMap.pt,
  ].join(",");

  const ptCsv = [ptFieldMap.salesperson, ptFieldMap.date, ptFieldMap.pt]
    .filter(Boolean)
    .join(",");

  const apoCsv = apoFieldMap
    ? [
        apoFieldMap.salesperson,
        apoFieldMap.apoType,
        apoFieldMap.date,
        apoFieldMap.estimateStatus,
      ]
        .filter(Boolean)
        .join(",")
    : "";

  const [targetRecords, ptRecords, apoRecords] = await Promise.all([
    fetchAllRecordsPages(
      targetAppId,
      targetCsv,
      { apiKey: apiKeyForAppFields("SALES_TARGET") },
      null,
      {
        operation: "sales-progress:target-records",
        appEnv: "SALES_TARGET_APP_ID",
      },
      { maxPages: TARGET_MAX_PAGES, maxRetries: 1 },
    ),
    fetchSalesDashboardRecordPages(ptAppId, ptCsv, salesDashboardPtListAuths(), {
      operation: "sales-progress:pt-records",
      appEnv: "SALES_DASHBOARD_PT_APP_ID",
    }),
    apoAppId && apoCsv
      ? fetchSalesDashboardRecordPages(
          apoAppId,
          apoCsv,
          salesDashboardApoListAuths(),
          {
            operation: "sales-progress:apo-records",
            appEnv: "SALES_DASHBOARD_APO_APP_ID",
          },
        ).catch((e) => {
          console.warn("[sales-progress] apo records skipped", e);
          return [] as AtPocketRecordRow[];
        })
      : Promise.resolve([] as AtPocketRecordRow[]),
  ]);

  // ── 集計 ──────────────────────────────────────────
  const targetResult = collectTargets(
    targetRecords,
    targetFieldMap,
    month,
    branchConfig,
  );

  const actualTotals: StaffTotals = new Map();
  const ptResult = collectPtActuals(ptRecords, ptFieldMap, month, actualTotals);
  const apoResult = apoFieldMap
    ? collectApoActuals(
        apoRecords,
        apoFieldMap,
        month,
        salesDashboardApoTypeFilterValues(),
        actualTotals,
      )
    : { rowsWithoutName: 0 };

  const actuals: SalesActualRow[] = [...actualTotals.entries()].map(
    ([staffName, v]) => ({ staffName, pt: v.pt, apoCount: v.apoCount }),
  );

  // 突合できなかった件数を記録する。氏名は出さない（K-1・運用で気づけるように）
  const matchSummary = summarizeSalesProgressMatching(
    targetResult.rows,
    actuals,
    {
      targetRowsWithoutName: targetResult.rowsWithoutName,
      actualRowsWithoutName:
        ptResult.rowsWithoutName + apoResult.rowsWithoutName,
    },
  );
  console.info(
    "[sales-progress] 突合結果",
    JSON.stringify({
      ym: month.ym,
      targetRows: targetResult.rows.length,
      actualStaff: actuals.length,
      excludedTargetRows: targetResult.excludedRows,
      ...matchSummary,
    }),
  );

  return {
    ym: month.ym,
    monthLabel: month.label,
    company: buildCompanySalesProgress(targetResult.rows, actuals),
    branches: aggregateSalesProgressByBranch(targetResult.rows, actuals, {
      fallbackLabel: branchConfig.otherLabel,
      ensureLabels: salesProgressBranchOrder(branchConfig),
    }),
    targets: targetResult.rows,
    actuals,
    targetsAvailable: targetResult.rows.length > 0,
  };
}
