import type {
  CalendarApiPayload,
  CalendarRecordMonthPatch,
} from "@/lib/calendar-api-types";

/** 保存直後にクライアントの byDay を差し替え（同一 recordId の旧行を除去してからマージ） */
export function applyCalendarRecordPatch(
  data: CalendarApiPayload,
  patch: CalendarRecordMonthPatch,
): CalendarApiPayload {
  const byDay: CalendarApiPayload["byDay"] = { ...data.byDay };
  const rid = patch.recordId;

  for (const [dayKey, list] of Object.entries(byDay)) {
    const next = list.filter((item) => item.recordId !== rid);
    if (next.length === 0) {
      delete byDay[dayKey];
    } else if (next.length !== list.length) {
      byDay[dayKey] = next;
    }
  }

  for (const [dayKey, items] of Object.entries(patch.byDay)) {
    const existing = byDay[dayKey] ?? [];
    const without = existing.filter((item) => item.recordId !== rid);
    byDay[dayKey] = [...without, ...items];
  }

  return { ...data, byDay };
}
