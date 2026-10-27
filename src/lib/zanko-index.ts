import type { AtPocketRecordRow } from "@/lib/atpocket";

import { pickRecordValueByFieldAliases } from "@/lib/calendar-kojo";
import { optionalCalendarYmd } from "@/lib/calendar-optional-ymd";
import { normalizeDateForInput } from "@/lib/customer-info-form/resolve-fields";
import { coerceCustomerInfoDisplayString } from "@/lib/customer-info-record";
import { normalizeDateTimeForPocketField } from "@/lib/jst-hm";
import { tNumberJoinKey } from "@/lib/t-number-join-key";

/**
 * 残工案件アプリ（186）の T番号 → 残工日[]（残工 段階1）。
 *
 * calendar_atpocket.js の buildTNumberToZankoDatesMap と同じ考え方。
 *   - 全レコードを残工として扱う（ステータス＝報告内容は見ない。
 *     ZANKO_STATUS_MATCH_VALUE が空文字＝全件採用、と同じ）
 *   - 残工日が空・読めないレコードも T番号 は載せる（段階3の【延期】で使う）
 *   - そのとき「残工日が空のレコードがあった」ことも持つ（段階4で使う）
 *   - 同じ T番号・同じ日付は1件にまとめ、日付は昇順
 *
 * T番号 は tNumberJoinKey（NFKC）でそろえる。
 * 日付はお客様情報の日付列と同じ読み方で JST の YYYY-MM-DD にする。
 */

export type ZankoIndex = {
  /** T番号（NFKC）→ 残工日（YYYY-MM-DD・昇順・重複なし）。日付が無くても空配列で載る */
  datesByT: Map<string, string[]>;
  /** 残工日が空（または読めない）レコードを1件でも持つ T番号 */
  tNumbersWithUndated: Set<string>;
  /** 残工日が空（または読めない）レコードの件数 */
  undatedRecordCount: number;
};

export type ZankoFieldIds = {
  tNumberFieldId: string;
  dateFieldId: string;
};

export function emptyZankoIndex(): ZankoIndex {
  return {
    datesByT: new Map(),
    tNumbersWithUndated: new Set(),
    undatedRecordCount: 0,
  };
}

/** @pocket の日付の値を JST の YYYY-MM-DD にする。読めなければ null（工事報告の完工日でも使う） */
export function readZankoDate(raw: unknown): string | null {
  const s = coerceCustomerInfoDisplayString(raw);
  if (!s) return null;
  const ymd = normalizeDateForInput(normalizeDateTimeForPocketField(s, "Date"));
  return optionalCalendarYmd(ymd);
}

export function buildZankoIndex(
  records: AtPocketRecordRow[],
  fids: ZankoFieldIds,
): ZankoIndex {
  const index = emptyZankoIndex();
  const seen = new Map<string, Set<string>>();

  for (const rec of records) {
    const recObj =
      rec && rec.record && typeof rec.record === "object"
        ? (rec.record as Record<string, unknown>)
        : null;
    if (!recObj) continue;

    const key = tNumberJoinKey(
      pickRecordValueByFieldAliases(recObj, fids.tNumberFieldId),
    );
    if (!key) continue;

    // 残工日が無くても T番号 は載せる（【延期】の判定に使う）
    if (!index.datesByT.has(key)) index.datesByT.set(key, []);

    const ymd = readZankoDate(
      pickRecordValueByFieldAliases(recObj, fids.dateFieldId),
    );
    if (!ymd) {
      index.tNumbersWithUndated.add(key);
      index.undatedRecordCount += 1;
      continue;
    }

    let days = seen.get(key);
    if (!days) {
      days = new Set();
      seen.set(key, days);
    }
    if (days.has(ymd)) continue;
    days.add(ymd);
    index.datesByT.get(key)!.push(ymd);
  }

  for (const days of index.datesByT.values()) days.sort();
  return index;
}
