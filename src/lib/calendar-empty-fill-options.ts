/** LIFF の工事空枠入力で送信する住宅ステータス値（@pocket の選択肢と一致させる） */

export const EMPTY_FILL_HOUSING_STATUS_VALUES = ["新築案件", "既築案件"] as const;

export type EmptyFillHousingStatus =
  (typeof EMPTY_FILL_HOUSING_STATUS_VALUES)[number];

export function isValidEmptyFillHousingStatus(
  v: string,
): v is EmptyFillHousingStatus {
  return (EMPTY_FILL_HOUSING_STATUS_VALUES as readonly string[]).includes(v);
}
