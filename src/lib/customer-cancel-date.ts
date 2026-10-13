import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import { dateValueForPocket } from "@/lib/customer-info-form/date-pocket";
import { jstYmd } from "@/lib/jst-hm";

/**
 * お客様情報の「キャンセル日」。
 *
 *   キャンセル以外 → キャンセル   キャンセルした日（JST）を書く
 *   キャンセル → キャンセル以外   空にする
 *
 * どちらも**保存の payload に1列足すだけ**で、@pocket への書き込みは増えない。
 * フォームのスキーマに無い列なので、工事対応者と同じく payload へ直接載せる。
 *
 * ■ 列は環境変数でだけ指定する
 * 見出しの一致で引くフォールバックは**入れない**。未設定・列定義と不一致の
 * ときは書かずに続ける（キャンセル処理そのものは止めない）。
 * filterCustomerInfoPutPayload の後段で載せるので、解決できない列を載せると
 * @pocket が 400 を返して保存全体が失敗する。
 */

/**
 * キャンセル日の列。環境変数が未設定、または列定義と一致しなければ null。
 * configured は「環境変数に値が入っていたか」（ログの切り分け用）
 */
export function resolveCustomerInfoCancelDateFieldId(
  appFields: AtPocketFieldRow[],
): { fieldId: string | null; configured: boolean } {
  const env = process.env.CUSTOMER_INFO_CANCEL_DATE_FIELD_ID?.trim();
  if (!env) return { fieldId: null, configured: false };
  return {
    fieldId: resolveConfiguredFieldToSchemaUniqueId(env, appFields),
    configured: true,
  };
}

/**
 * @pocket へ書く「今日」。他の日付列と同じ YYYY/MM/DD。
 * サーバは UTC なので、必ず JST の暦日から作る
 */
export function customerCancelDateValue(now: Date = new Date()): string {
  return dateValueForPocket(jstYmd(now)) ?? "";
}

/** 列を解決できず書かなかったことを残す。**真偽値だけ**（値・氏名・T番号は出さない） */
function logCancelDateSkipped(
  action: "write" | "clear",
  configured: boolean,
): void {
  console.info(
    "[customer-cancel] キャンセル日の列を解決できないため、書き込みをスキップ",
    JSON.stringify({ action, configured, resolved: false }),
  );
}

/** キャンセルした日を payload に載せる。既存の値があっても上書きする */
export function applyCustomerCancelDateToPayload(
  payload: Record<string, unknown>,
  appFields: AtPocketFieldRow[],
  now: Date = new Date(),
): boolean {
  const { fieldId, configured } =
    resolveCustomerInfoCancelDateFieldId(appFields);
  const value = customerCancelDateValue(now);
  if (!fieldId || !value) {
    logCancelDateSkipped("write", configured);
    return false;
  }
  payload[fieldId] = value;
  return true;
}

/**
 * キャンセルを解除した保存で、キャンセル日を空にする。
 * **するのはこれだけ。** 工事レコードや PT には触らない
 */
export function clearCustomerCancelDateInPayload(
  payload: Record<string, unknown>,
  appFields: AtPocketFieldRow[],
): boolean {
  const { fieldId, configured } =
    resolveCustomerInfoCancelDateFieldId(appFields);
  if (!fieldId) {
    logCancelDateSkipped("clear", configured);
    return false;
  }
  payload[fieldId] = "";
  return true;
}
