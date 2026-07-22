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

/** 工事対応者名だけをローカル更新（再取得が 429 のときのフォールバック） */
export function applyConstructionHandlerNameLocal(
  data: CalendarApiPayload,
  recordId: string,
  constructionHandlerName: string,
): CalendarApiPayload {
  const rid = recordId.trim();
  const name = constructionHandlerName.trim();
  if (!rid || !name) return data;

  let changed = false;
  const byDay: CalendarApiPayload["byDay"] = {};
  for (const [dayKey, list] of Object.entries(data.byDay)) {
    let dayChanged = false;
    const next = list.map((item) => {
      if (item.recordId !== rid) return item;
      if (item.constructionHandlerName === name) return item;
      dayChanged = true;
      return { ...item, constructionHandlerName: name };
    });
    byDay[dayKey] = dayChanged ? next : list;
    if (dayChanged) changed = true;
  }
  return changed ? { ...data, byDay } : data;
}
