import type { LiffCalendarPageConfig } from "@/lib/liff-calendar-page-config";

/**
 * 工事カレンダーの案件カード →（契約情報入力フォーム）お客様情報 の導線。
 *
 * 工事アプリとお客様情報アプリはレコードIDが別なので、案件カードが持つ
 * T番号を API で変換してから遷移する。
 *
 * **表示条件と遷移判定はこのファイルの関数だけから導くこと。**
 * 画面側で条件を書き直すと、出ていないボタンの経路が生き残る形の
 * ズレが起きる（配線方式で同じ形の事故が記録されている）。
 */

/** T番号 → お客様情報レコードID の変換 API（段階1で追加） */
export const CUSTOMER_INFO_RECORD_ID_PATH = "/api/customer-info/record-id";

/** 見つからない。API の 404 と同じ文言にそろえる */
export const CUSTOMER_INFO_LINK_NOT_FOUND_MESSAGE =
  "該当するお客様情報が見つかりません";
/** 連続操作。API の 429 は理由を書かないので画面側の文言を出す */
export const CUSTOMER_INFO_LINK_RATE_LIMITED_MESSAGE =
  "操作が集中しています。少し待ってから再度お試しください";
/** それ以外。原因を推測して書き分けない */
export const CUSTOMER_INFO_LINK_GENERIC_ERROR_MESSAGE =
  "お客様情報を開けませんでした";

/**
 * 案件カードにボタンを出すか。
 *
 * 既定は出さない（未指定 = false）。コミュニケーションブリッジと部品を
 * 共用しているため、明示的に true にした画面だけに出す。
 * T番号が無い案件では**ボタンごと出さない**。押せない理由を毎回
 * 問われるので、グレーアウトでは残さない。
 */
export function shouldShowCustomerInfoLink(
  config: Pick<LiffCalendarPageConfig, "showCustomerInfoLink">,
  tNumber: string | undefined,
): boolean {
  if (config.showCustomerInfoLink !== true) return false;
  return (tNumber ?? "").trim().length > 0;
}

/** 変換 API の呼び出し先。値はここでエンコードする */
export function customerInfoRecordIdLookupPath(tNumber: string): string {
  const t = tNumber.trim();
  return `${CUSTOMER_INFO_RECORD_ID_PATH}?tNumber=${encodeURIComponent(t)}`;
}

/** 契約情報入力フォームの URL（既存の customer-list / ホームと同じ形） */
export function customerInfoEditHref(recordId: string): string {
  return `/customer-info?recordId=${encodeURIComponent(recordId.trim())}`;
}

export type CustomerInfoLinkResponseBody = {
  recordId?: string;
  error?: string;
};

/**
 * 変換 API の応答 → 画面の動き。
 *   open  … その URL へ遷移する
 *   error … その文言を出す。**遷移しない**
 */
export type CustomerInfoLinkOutcome =
  | { kind: "open"; href: string }
  | { kind: "error"; text: string };

export function customerInfoLinkOutcome(
  status: number,
  body: CustomerInfoLinkResponseBody | null,
): CustomerInfoLinkOutcome {
  if (status === 200) {
    const recordId = body?.recordId?.trim() ?? "";
    // 200 なのに ID が無いのは想定外。遷移先が作れないのでエラー扱い
    if (!recordId) {
      return { kind: "error", text: CUSTOMER_INFO_LINK_GENERIC_ERROR_MESSAGE };
    }
    return { kind: "open", href: customerInfoEditHref(recordId) };
  }
  if (status === 404) {
    return { kind: "error", text: CUSTOMER_INFO_LINK_NOT_FOUND_MESSAGE };
  }
  if (status === 429) {
    return { kind: "error", text: CUSTOMER_INFO_LINK_RATE_LIMITED_MESSAGE };
  }
  if (status === 503) {
    // 設定不足の案内。サーバの固定文言をそのまま出す
    const text = body?.error?.trim() ?? "";
    return {
      kind: "error",
      text: text || CUSTOMER_INFO_LINK_GENERIC_ERROR_MESSAGE,
    };
  }
  return { kind: "error", text: CUSTOMER_INFO_LINK_GENERIC_ERROR_MESSAGE };
}
