import "server-only";

import type { AtPocketRecordRow } from "@/lib/atpocket";
import {
  fetchAllRecordsPages,
  isPocketApiRateLimited,
  isPocketHttpRateLimitError,
  listAuthsForCommunicationBridgeCalendar,
} from "@/lib/atpocket";

type CacheEntry = {
  key: string;
  freshUntil: number;
  staleUntil: number;
  rows: AtPocketRecordRow[];
};

let recordsCache: CacheEntry | null = null;
let recordsInflight: Promise<AtPocketRecordRow[]> | null = null;

const STALE_SERVE_MS = 6 * 60 * 60 * 1000;

function cacheTtlMs(): number {
  const raw =
    process.env.COMMUNICATION_BRIDGE_CALENDAR_RECORDS_CACHE_SECONDS?.trim() ??
    process.env.CALENDAR_CONSTRUCTION_CACHE_SECONDS?.trim();
  const sec = raw ? Number(raw) : 300;
  if (!Number.isFinite(sec)) return 300_000;
  return Math.min(3_600, Math.max(60, sec)) * 1000;
}

function maxPages(): number {
  const raw =
    process.env.COMMUNICATION_BRIDGE_CALENDAR_MAX_PAGES?.trim() ??
    process.env.CALENDAR_CONSTRUCTION_MAX_PAGES?.trim();
  const n = raw ? Number(raw) : 15;
  if (!Number.isFinite(n) || n < 1) return 15;
  return Math.min(200, Math.floor(n));
}

function cacheKey(
  appId: string,
  fieldsCsv: string,
  pocketQuery: string | null,
): string {
  return `${appId}\0${fieldsCsv}\0${pocketQuery ?? ""}`;
}

function getStaleRows(key: string): AtPocketRecordRow[] | null {
  if (!recordsCache || recordsCache.key !== key) return null;
  if (Date.now() > recordsCache.staleUntil) return null;
  return recordsCache.rows;
}

/** コミュニケーションブリッジカレンダーアプリの月次一覧 */
export async function fetchCommunicationBridgeCalendarRecordsCached(
  appId: string,
  fieldsCsv: string,
  pocketQuery: string | null | undefined,
): Promise<AtPocketRecordRow[]> {
  const csv = fieldsCsv.trim();
  if (!csv) return [];

  const query = pocketQuery?.trim() || null;
  const key = cacheKey(appId, csv, query);
  const now = Date.now();

  if (recordsCache && recordsCache.key === key && now < recordsCache.freshUntil) {
    return recordsCache.rows;
  }

  const stale = getStaleRows(key);
  const listAuths = listAuthsForCommunicationBridgeCalendar();
  if (listAuths.some((a) => isPocketApiRateLimited(a)) && stale?.length) {
    return stale;
  }

  if (recordsInflight) return recordsInflight;

  recordsInflight = (async () => {
    try {
      const rows = await fetchAllRecordsPages(
        appId,
        csv,
        listAuths[0],
        query,
        {
          operation: "communication-bridge-calendar:一覧",
          appEnv: "COMMUNICATION_BRIDGE_CALENDAR_APP_ID",
        },
        {
          maxPages: maxPages(),
          maxRetries: 1,
          authKeys: listAuths,
        },
      );
      const ttl = cacheTtlMs();
      recordsCache = {
        key,
        freshUntil: Date.now() + ttl,
        staleUntil: Date.now() + ttl + STALE_SERVE_MS,
        rows,
      };
      return rows;
    } catch (e) {
      if (isPocketHttpRateLimitError(e) && stale?.length) {
        console.warn(
          "[communication-bridge-calendar-records-cache] serving stale records after 429",
        );
        return stale;
      }
      throw e;
    } finally {
      recordsInflight = null;
    }
  })();

  return recordsInflight;
}
