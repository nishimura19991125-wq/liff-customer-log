/** 工事空枠のダブルブッキング検知時（クライアント・API 共通） */
export const CALENDAR_SLOT_CONFLICT_MESSAGE =
  "一瞬前に他のメンバーがこの枠を確定しました。最新情報に更新します";

export type CalendarSlotConflictBody = {
  slotConflict: true;
  error: string;
};

export function isCalendarSlotConflictBody(
  body: unknown,
): body is CalendarSlotConflictBody {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { slotConflict?: unknown }).slotConflict === true
  );
}
