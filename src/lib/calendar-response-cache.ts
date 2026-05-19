import "server-only";

import type { CalendarApiPayload } from "@/lib/calendar-api-types";

/**
 * 認証済みユーザー間で共有できるカレンダー JSON のみキャッシュする。
 * （ペイロードは LINE ユーザー別フィルタなし・組織共通データ前提）
 */
type Entry = { expiresAt: number; payload: CalendarApiPayload };
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<CalendarApiPayload>>();

/** GET /api/calendar と同じキー（route と invalidate で共有） */
export function buildCalendarPayloadCacheKey(year: number, month: number): string {
  const calAppId = process.env.CALENDAR_APP_ID?.trim() ?? "";
  const reportAppId = process.env.CALENDAR_REPORT_APP_ID?.trim() ?? "";
  const extraRaw = process.env.CALENDAR_EXTRA_HOLIDAYS?.trim();
  const extraHolidayKeys = extraRaw
    ? extraRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const includeSandwich =
    process.env.CALENDAR_INCLUDE_SANDWICH_NATIONAL_HOLIDAY?.trim() === "true";
  const recordsQueryFilterEnabled =
    process.env.CALENDAR_RECORDS_QUERY_FILTER?.trim() === "true";

  return JSON.stringify({
    v: 3,
    calAppId,
    reportAppId,
    extra: extraHolidayKeys.slice().sort().join(","),
    sandwich: includeSandwich,
    recordsQueryFilter: recordsQueryFilterEnabled,
    year,
    month,
  });
}

/** 工事登録・空枠更新後に呼び、表示月のキャッシュを捨てる */
export function invalidateCalendarPayloadCacheForMonth(
  year: number,
  month: number,
): void {
  const key = buildCalendarPayloadCacheKey(year, month);
  store.delete(key);
  inflight.delete(key);
}

/** 表示月が不明なとき用（組織共通キャッシュをすべて破棄） */
export function invalidateAllCalendarPayloadCache(): void {
  store.clear();
  inflight.clear();
}

export async function getOrComputeCalendarPayload(
  cacheKey: string,
  ttlMs: number,
  compute: () => Promise<CalendarApiPayload>,
): Promise<CalendarApiPayload> {
  if (ttlMs <= 0) return compute();

  const now = Date.now();
  const hit = store.get(cacheKey);
  if (hit && hit.expiresAt > now) return hit.payload;

  const pending = inflight.get(cacheKey);
  if (pending) return pending;

  const p = (async () => {
    try {
      const payload = await compute();
      store.set(cacheKey, {
        expiresAt: Date.now() + ttlMs,
        payload,
      });
      return payload;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, p);
  return p;
}
