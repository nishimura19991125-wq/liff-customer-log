import "server-only";

import type { AtPocketFetchAuth, AtPocketRecordRow } from "@/lib/atpocket";
import {
  fetchAllRecordsPages,
  isPocketHttpRateLimitError,
  listAuthsForAppList,
  pocketApiRateLimitRemainingMs,
} from "@/lib/atpocket";

type ReportCacheEntry = {
  key: string;
  freshUntil: number;
  staleUntil: number;
  rows: AtPocketRecordRow[];
};

let reportCache: ReportCacheEntry | null = null;
let reportInflight: Promise<AtPocketRecordRow[]> | null = null;

const REPORT_STALE_SERVE_MS = 6 * 60 * 60 * 1000;

function reportCacheTtlMs(): number {
  const raw = process.env.CALENDAR_REPORT_CACHE_SECONDS?.trim();
  const sec = raw ? Number(raw) : 1800;
  if (!Number.isFinite(sec)) return 1_800_000;
  return Math.min(7_200, Math.max(60, sec)) * 1000;
}

function reportMaxPages(): number {
  const raw = process.env.CALENDAR_REPORT_MAX_PAGES?.trim();
  const n = raw ? Number(raw) : 30;
  if (!Number.isFinite(n) || n < 1) return 30;
  return Math.min(200, Math.floor(n));
}

function cacheKey(reportAppId: string, fieldsCsv: string): string {
  return `${reportAppId}\u0000${fieldsCsv}`;
}

function getStaleRows(key: string): AtPocketRecordRow[] | null {
  if (!reportCache || reportCache.key !== key) return null;
  if (Date.now() > reportCache.staleUntil) return null;
  return reportCache.rows;
}

/** 工事報告アプリの全件一覧（T番号→報告内容マップ用・月をまたいでキャッシュ） */
export async function fetchCalendarReportRecordsCached(
  reportAppId: string,
  fieldsCsv: string,
): Promise<AtPocketRecordRow[]> {
  const csv = fieldsCsv.trim();
  if (!csv) return [];

  const listAuths = listAuthsForAppList("CALENDAR_REPORT", [
    "CALENDAR_REPORT_ATPOCKET_API_KEY",
    "CALENDAR_REPORT_ATPOCKET_API_KEY_1",
    "CALENDAR_REPORT_ATPOCKET_API_KEY_2",
  ]);
  const key = cacheKey(reportAppId, csv);
  const now = Date.now();

  if (reportCache && reportCache.key === key && now < reportCache.freshUntil) {
    return reportCache.rows;
  }

  const stale = getStaleRows(key);
  if (reportInflight) return reportInflight;

  reportInflight = (async () => {
    try {
      const rows = await fetchAllRecordsPages(
        reportAppId,
        csv,
        listAuths[0],
        null,
        {
          operation: "calendar:工事報告一覧",
          appEnv: "CALENDAR_REPORT_APP_ID",
        },
        {
          maxPages: reportMaxPages(),
          maxRetries: 1,
          authKeys: listAuths,
        },
      );
      const ttl = reportCacheTtlMs();
      reportCache = {
        key,
        freshUntil: Date.now() + ttl,
        staleUntil: Date.now() + ttl + REPORT_STALE_SERVE_MS,
        rows,
      };
      return rows;
    } catch (e) {
      if (isPocketHttpRateLimitError(e) && stale?.length) {
        console.warn(
          "[calendar-report-cache] serving stale report records after 429",
        );
        return stale;
      }
      throw e;
    } finally {
      reportInflight = null;
    }
  })();

  return reportInflight;
}

export function invalidateCalendarReportRecordsCache(): void {
  reportCache = null;
  reportInflight = null;
}

export function calendarReportRateLimitRetryAfterSec(
  auth?: AtPocketFetchAuth,
): number {
  return Math.max(
    60,
    Math.ceil(pocketApiRateLimitRemainingMs(auth) / 1000) || 120,
  );
}
