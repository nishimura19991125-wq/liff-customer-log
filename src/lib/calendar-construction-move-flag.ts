/**
 * 工事日の変更を止める切り替え。
 *
 * 工事日が決まった案件の工事日を、工事カレンダーから変えられないように
 * している。工事カレンダーでできるのは登録だけ。
 *
 * ■ 既定は false（止まった状態）
 * 変数が無いとき・"true" 以外のときは止める。戻すときは
 * CALENDAR_CONSTRUCTION_MOVE_ENABLED=true を入れるだけでよい。
 * 工事日を変更するパネル（calendar-move-case-panel.tsx）と
 * 3本の API の実装は**消さずに残してある**。
 *
 * ■ 止めるもの
 *   画面：案件カードの「工事日を変更」（出さない）
 *   API ：move-construction-case / assign-case-to-slot /
 *         schedule-undated-case（403。calendar-construction-move-gate.ts）
 *
 * ⚠ このファイルは画面からも読むので server-only にしない。
 *    画面側は環境変数を直接読めないため、/api/calendar の応答に載った
 *    constructionMoveEnabled を shouldShowConstructionMovePanel に渡す。
 */

export const CALENDAR_CONSTRUCTION_MOVE_ENABLED_ENV =
  "CALENDAR_CONSTRUCTION_MOVE_ENABLED";

/** サーバ側で読む。"true"（大文字小文字・前後の空白は問わない）だけが true */
export function isCalendarConstructionMoveEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env[CALENDAR_CONSTRUCTION_MOVE_ENABLED_ENV];
  return raw?.trim().toLowerCase() === "true";
}

/**
 * 案件カードに「工事日を変更」を出すか。
 *
 * 止めているときは押せないボタンを出すのではなく、出さない。
 * フラグが届いていない（古い応答・取得失敗）ときも出さない側へ倒す。
 */
export function shouldShowConstructionMovePanel(opts: {
  enableEmptySlotFill: boolean;
  constructionMoveEnabled: boolean | undefined;
}): boolean {
  return opts.enableEmptySlotFill && opts.constructionMoveEnabled === true;
}
