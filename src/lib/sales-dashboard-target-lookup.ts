import "server-only";

import { apiKeyForAppFields, fetchAllRecordsPages, fetchAppFields } from "@/lib/atpocket";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { readCustomerInfoFieldValue } from "@/lib/customer-info-record";
import { isExcludedSalesDashboardRankingName } from "@/lib/sales-dashboard-ranking-exclude";
import { parseSalesDashboardRecordYmFromField } from "@/lib/sales-dashboard-record-date";
import {
  resolveSalesTargetFieldMap,
  salesTargetAppId,
} from "@/lib/sales-target-fields";

/**
 * 目標登録(月次)アプリから **PT の目標値だけ** を引く（ランキング用）。
 *
 * ■ なぜ営業進捗の処理を呼ばないか
 * あちらの入口は buildSalesProgressCore（sales-progress-data.ts）だけで、
 * 目標の読み取り（collectTargets）は非公開。そのうえ同じ呼び出しの中で
 * PT集計表とアポ取得情報も全件走査する。ダッシュボードは既に両方を
 * 取っているので、丸ごと呼ぶと重い側の取得が二重になる。
 * ここは目標アプリだけを読む。
 *
 * ■ @pocket の往復
 * 列定義1回（30分キャッシュ・atpocket.ts の APP_FIELDS_DEFAULT_TTL_SECONDS）＋
 * レコード最大10ページ。呼び出し元の集計自体が30分キャッシュされるので、
 * 増えるのは実質「30分に1回・期間ごと」。
 *
 * ■ 失敗しても投げない
 * 目標はランキングの付加情報で、これが取れないことを理由に画面を落とさない。
 * 取れなければ空で返し、呼び出し側が 0 として扱う（達成率0%・棒は空）。
 */

/** 目標アプリのページ上限。営業進捗（sales-progress-data.ts）と同じ */
const TARGET_MAX_PAGES = 10;

/** 目標値の読み方は実績側（aggregatePtRecords）と同じ。マイナス記号は落ちる */
function parseNumber(raw: string): number {
  const digits = raw.replace(/[^\d]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

export type SalesDashboardTargetLookup = {
  /** 正規化担当者名 → 対象月の PT 目標。取れなければ空 */
  ptByStaff: Map<string, number>;
  /** 目標アプリを読めたか（未設定・取得失敗は false） */
  available: boolean;
};

const EMPTY: SalesDashboardTargetLookup = {
  ptByStaff: new Map(),
  available: false,
};

export async function fetchSalesDashboardPtTargets(month: {
  year: number;
  month1: number;
}): Promise<SalesDashboardTargetLookup> {
  const appId = salesTargetAppId();
  if (!appId) return EMPTY;

  const auth = { apiKey: apiKeyForAppFields("SALES_TARGET") };

  try {
    const fields = await fetchAppFields(appId, auth, {
      operation: "sales-dashboard:target-fields",
      appEnv: "SALES_TARGET_APP_ID",
    });
    const fieldMap = resolveSalesTargetFieldMap(fields);
    if (!fieldMap) {
      console.warn(
        "[sales-dashboard-target-lookup] 目標アプリの列を解決できません（目標は表示しません）",
      );
      return EMPTY;
    }

    // 使うのは3列だけ。支社・アポ件数は運ばない
    const csv = [fieldMap.month, fieldMap.staffName, fieldMap.pt].join(",");
    const records = await fetchAllRecordsPages(
      appId,
      csv,
      auth,
      null,
      {
        operation: "sales-dashboard:target-records",
        appEnv: "SALES_TARGET_APP_ID",
      },
      { maxPages: TARGET_MAX_PAGES, maxRetries: 1 },
    );

    const ptByStaff = new Map<string, number>();
    for (const row of records) {
      const rec = row.record;
      if (!rec || typeof rec !== "object") continue;
      const recObj = rec as Record<string, unknown>;

      const ym = parseSalesDashboardRecordYmFromField(recObj, fieldMap.month);
      if (!ym || ym.year !== month.year || ym.month1 !== month.month1) continue;

      const name = normApClStaffName(
        readCustomerInfoFieldValue(recObj, fieldMap.staffName),
      );
      // 実績側と同じ除外を掛ける。片側だけ除外すると達成率が歪む
      if (!name || isExcludedSalesDashboardRankingName(name)) continue;

      const pt = parseNumber(readCustomerInfoFieldValue(recObj, fieldMap.pt));
      // 同じ人に複数行あるときは合算する（営業進捗の集計と同じ扱い）
      ptByStaff.set(name, (ptByStaff.get(name) ?? 0) + pt);
    }

    return { ptByStaff, available: true };
  } catch (e) {
    console.warn(
      "[sales-dashboard-target-lookup] 目標の取得に失敗しました（目標は表示しません）",
      e instanceof Error ? e.message : String(e),
    );
    return EMPTY;
  }
}
