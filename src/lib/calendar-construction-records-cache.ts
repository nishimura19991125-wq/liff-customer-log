import "server-only";

import type { AtPocketFetchAuth, AtPocketRecordRow } from "@/lib/atpocket";
import { startServerTimingLog } from "@/lib/server-timing-log";
import {
  fetchAllRecordsPages,
  isPocketApiRateLimited,
  isPocketHttpRateLimitError,
  listAuthsForAppList,
} from "@/lib/atpocket";

type ConstructionCacheEntry = {
  key: string;
  freshUntil: number;
  staleUntil: number;
  rows: AtPocketRecordRow[];
};

let constructionCache: ConstructionCacheEntry | null = null;
/**
 * 実行中の取得はキーごとに持つ。
 *
 * 1本だけ持ってキーを比べずに使い回すと、同時に来た別の月（別の query）の
 * 要求に、先に始まった月の行を返してしまう。
 */
const constructionInflight = new Map<string, Promise<AtPocketRecordRow[]>>();

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
  return `${calAppId}\u0000${fieldsCsv}\u0000${pocketQuery ?? ""}`;
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
  const listAuths = listAuthsForAppList("CALENDAR");
  if (listAuths.some((a) => isPocketApiRateLimited(a)) && stale?.length) {
    return stale;
  }

  const running = constructionInflight.get(key);
  if (running) return running;

  const inflight = (async () => {
    /**
     * 何件運んでいるかを出す（CALENDAR_TIMING_LOG=true のときだけ）。
     *
     * お客様情報のキー照合では query が完全に無視され、毎回全件を
     * 運んでいた。こちらの月クエリ（buildConstructionRecordsMonthOverlapQuery）は
     * and / or / 比較演算子を使う別の構文で、効いているかは分かっていない。
     * 効いていなければ、この1回が全件取得になる。
     *
     * rows が月内の件数に見合わないほど多ければ、月クエリも効いていない。
     */
    const timing = startServerTimingLog("calendar-construction-records");
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
      timing.mark("fetch");
      timing.flush({
        rows: rows.length,
        hasQuery: Boolean(query),
        pageLimit: 1000,
        maxPages: constructionMaxPages(),
      });
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
    }
  })();

  constructionInflight.set(key, inflight);
  // 終わったら自分の分だけ外す。途中で invalidate されて同じキーの新しい
  // 取得が入っていたら、それは消さない
  const release = () => {
    if (constructionInflight.get(key) === inflight) {
      constructionInflight.delete(key);
    }
  };
  inflight.then(release, release);

  return inflight;
}

export function invalidateCalendarConstructionRecordsCache(): void {
  constructionCache = null;
  constructionInflight.clear();
}
