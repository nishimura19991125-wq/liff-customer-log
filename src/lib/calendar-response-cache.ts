import "server-only";

import type { CalendarApiPayload } from "@/lib/calendar-api-types";

/**
 * 認証済みユーザー間で共有できるカレンダー JSON のみキャッシュする。
 * （ペイロードは LINE ユーザー別フィルタなし・組織共通データ前提）
 */
type Entry = { expiresAt: number; payload: CalendarApiPayload };
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<CalendarApiPayload>>();

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
