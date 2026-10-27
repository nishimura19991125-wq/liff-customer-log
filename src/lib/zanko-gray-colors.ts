/**
 * グレー表示の左の縦線（@pocket の POSTPONED_COLOR_LINE）。
 *
 * グレーのカードでは施工業者の色ではなくこの色にする（@pocket と同じ）。
 * 背景・枠線・文字の色は globals.css（.zanko-gray-body / .zanko-gray-card）。
 * 画面から読むので server-only にしない。
 */
export const ZANKO_GRAY_LINE_COLOR = "#3f3f3f";

/**
 * 残工日が未定の ⚠️ にマウスを乗せたときの説明文（残工 段階4-a）。
 * @pocket の calendar_atpocket.js と同じ文言。
 */
export const ZANKO_NO_DATE_WARN_TITLE =
  "残工日が未定です（残工案件アプリに登録済み・日付未入力）";
