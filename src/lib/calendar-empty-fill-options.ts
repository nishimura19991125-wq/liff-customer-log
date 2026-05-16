/** LIFF の工事空枠入力で送信する住宅ステータス値（@pocket の選択肢と一致させる） */

export const EMPTY_FILL_HOUSING_STATUS_VALUES = ["新築案件", "既築案件"] as const;

/** UI/API と共通する「新築案件」固定文言（選択肢の先頭と一致） */
export const EMPTY_FILL_HOUSING_STATUS_NEW_BUILD =
  EMPTY_FILL_HOUSING_STATUS_VALUES[0];

export type EmptyFillHousingStatus =
  (typeof EMPTY_FILL_HOUSING_STATUS_VALUES)[number];

/** @returns true のとき body は EmptyFillHousingStatus のサブタイプ */
export function isValidEmptyFillHousingStatus(
  v: string,
): v is EmptyFillHousingStatus {
  return (EMPTY_FILL_HOUSING_STATUS_VALUES as readonly string[]).includes(v);
}
