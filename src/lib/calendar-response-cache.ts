import "server-only";

import type { CalendarApiPayload } from "@/lib/calendar-api-types";
import { invalidateCalendarConstructionRecordsCache } from "@/lib/calendar-construction-records-cache";
import { invalidateCalendarReportRecordsCache } from "@/lib/calendar-report-records-cache";
import { isPocketHttpRateLimitError } from "@/lib/atpocket";

/**
 * 認証済みユーザー間で共有できるカレンダー JSON のみキャッシュする。
 * （ペイロードは LINE ユーザー別フィルタなし・組織共通データ前提）
 */
type Entry = {
  expiresAt: number;
  staleUntil: number;
  payload: CalendarApiPayload;
};
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<CalendarApiPayload>>();

const CALENDAR_PAYLOAD_STALE_SERVE_MS = 6 * 60 * 60 * 1000;

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
    process.env.CALENDAR_RECORDS_QUERY_FILTER?.trim() !== "false";

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
  invalidateCalendarConstructionRecordsCache();
}

/** 表示月が不明なとき用（組織共通キャッシュをすべて破棄） */
export function invalidateAllCalendarPayloadCache(): void {
  store.clear();
  inflight.clear();
  invalidateCalendarReportRecordsCache();
  invalidateCalendarConstructionRecordsCache();
}

/** 429 時などに期限切れでも返せるペイロード（あれば） */
export function getStaleCalendarPayload(
  cacheKey: string,
): CalendarApiPayload | null {
  const hit = store.get(cacheKey);
  if (!hit || Date.now() > hit.staleUntil) return null;
  return hit.payload;
}

/** 別月でもよいので直近のカレンダー JSON（429 フォールバック） */
export function getAnyStaleCalendarPayload(): CalendarApiPayload | null {
  const now = Date.now();
  let best: Entry | null = null;
  for (const entry of store.values()) {
    if (entry.staleUntil <= now) continue;
    if (!best || entry.staleUntil > best.staleUntil) {
      best = entry;
    }
  }
  return best?.payload ?? null;
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
      const now = Date.now();
      store.set(cacheKey, {
        expiresAt: now + ttlMs,
        staleUntil: now + ttlMs + CALENDAR_PAYLOAD_STALE_SERVE_MS,
        payload,
      });
      return payload;
    } catch (e) {
      if (isPocketHttpRateLimitError(e)) {
        const stale =
          getStaleCalendarPayload(cacheKey) ?? getAnyStaleCalendarPayload();
        if (stale) {
          console.warn(
            "[calendar-response-cache] serving stale payload after 429",
            cacheKey,
          );
          return stale;
        }
      }
      throw e;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, p);
  return p;
}
