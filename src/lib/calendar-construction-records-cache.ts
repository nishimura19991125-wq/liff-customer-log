import "server-only";

import type { AtPocketFetchAuth, AtPocketRecordRow } from "@/lib/atpocket";
import {
  apiKeyForCalendarPocket,
  apiKeyForCalendarPocket1,
  fetchAllRecordsPages,
  isPocketApiRateLimited,
  isPocketHttpRateLimitError,
} from "@/lib/atpocket";

type ConstructionCacheEntry = {
  key: string;
  freshUntil: number;
  staleUntil: number;
  rows: AtPocketRecordRow[];
};

let constructionCache: ConstructionCacheEntry | null = null;
let constructionInflight: Promise<AtPocketRecordRow[]> | null = null;

const CONSTRUCTION_STALE_SERVE_MS = 6 * 60 * 60 * 1000;

function constructionCacheTtlMs(): number {
  const raw = process.env.CALENDAR_CONSTRUCTION_CACHE_SECONDS?.trim();
  const sec = raw ? Number(raw) : 300;
  if (!Number.isFinite(sec)) return 300_000;
  return Math.min(3_600, Math.max(60, sec)) * 1000;
}

function constructionMaxPages(): number {
  const raw = process.env.CALENDAR_CONSTRUCTION_MAX_PAGES?.trim();
  const n = raw ? Number(raw) : 15;
  if (!Number.isFinite(n) || n < 1) return 15;
  return Math.min(200, Math.floor(n));
}

function cacheKey(
  calAppId: string,
  fieldsCsv: string,
  pocketQuery: string | null,
): string {
  return `${calAppId}\0${fieldsCsv}\0${pocketQuery ?? ""}`;
}

function getStaleRows(key: string): AtPocketRecordRow[] | null {
  if (!constructionCache || constructionCache.key !== key) return null;
  if (Date.now() > constructionCache.staleUntil) return null;
  return constructionCache.rows;
}

/** 工事アプリの月次一覧（@pocket query 付き・月ごとにキャッシュ） */
export async function fetchCalendarConstructionRecordsCached(
  calAppId: string,
  fieldsCsv: string,
  pocketQuery: string | null | undefined,
): Promise<AtPocketRecordRow[]> {
  const csv = fieldsCsv.trim();
  if (!csv) return [];

  const query = pocketQuery?.trim() || null;
  const key = cacheKey(calAppId, csv, query);
  const now = Date.now();

  if (
    constructionCache &&
    constructionCache.key === key &&
    now < constructionCache.freshUntil
  ) {
    return constructionCache.rows;
  }

  const stale = getStaleRows(key);
  const listAuths: AtPocketFetchAuth[] = [
    { apiKey: apiKeyForCalendarPocket1() },
    { apiKey: apiKeyForCalendarPocket() },
  ];
  if (listAuths.some((a) => isPocketApiRateLimited(a)) && stale?.length) {
    return stale;
  }

  if (constructionInflight) return constructionInflight;

  constructionInflight = (async () => {
    try {
      const rows = await fetchAllRecordsPages(
        calAppId,
        csv,
        listAuths[0],
        query,
        {
          operation: "calendar:工事一覧",
          appEnv: "CALENDAR_APP_ID",
        },
        {
          maxPages: constructionMaxPages(),
          maxRetries: 1,
          authKeys: listAuths,
        },
      );
      const ttl = constructionCacheTtlMs();
      constructionCache = {
        key,
        freshUntil: Date.now() + ttl,
        staleUntil: Date.now() + ttl + CONSTRUCTION_STALE_SERVE_MS,
        rows,
      };
      return rows;
    } catch (e) {
      if (isPocketHttpRateLimitError(e) && stale?.length) {
        console.warn(
          "[calendar-construction-cache] serving stale construction records after 429",
        );
        return stale;
      }
      throw e;
    } finally {
      constructionInflight = null;
    }
  })();

  return constructionInflight;
}

export function invalidateCalendarConstructionRecordsCache(): void {
  constructionCache = null;
  constructionInflight = null;
}
