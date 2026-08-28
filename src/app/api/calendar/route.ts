import { NextResponse } from "next/server";

import type { CalendarApiPayload } from "@/lib/calendar-api-types";
import {
  buildCalendarPayload,
  buildConstructionRecordsMonthOverlapQuery,
  collectConstructionFieldsCsv,
  collectReportFieldsCsv,
  resolveConstructionFieldIds,
  resolveReportFieldIds,
} from "@/lib/calendar-kojo";
import { resolveConstructionMapAddressFieldIds } from "@/lib/map-address-fields";
import {
  fetchCalendarConstructionRecordsCached,
  invalidateCalendarConstructionRecordsCache,
} from "@/lib/calendar-construction-records-cache";
import {
  buildCalendarPayloadCacheKey,
  getAnyStaleCalendarPayload,
  getOrComputeCalendarPayload,
  getStaleCalendarPayload,
  invalidateCalendarPayloadCacheForMonth,
} from "@/lib/calendar-response-cache";
import {
  calendarReportRateLimitRetryAfterSec,
  fetchCalendarReportRecordsCached,
} from "@/lib/calendar-report-records-cache";
import {
  apiKeyForCalendarPocket,
  apiKeyForCalendarReportPocket1,
  fetchAppFields,
  isPocketHttpRateLimitError,
  pocketApiRateLimitRemainingMs,
} from "@/lib/atpocket";
import { calendarConstructionHandlerFieldIdFromEnv } from "@/lib/calendar-construction-handler-env";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { constructionHandlerStaffConfigReady } from "@/lib/staff-construction-handler-candidates";

export const dynamic = "force-dynamic";

function calendarCacheTtlMs(): number {
  const raw = process.env.CALENDAR_RESPONSE_CACHE_SECONDS?.trim();
  const sec = raw ? Number(raw) : 120;
  if (!Number.isFinite(sec)) return 120_000;
  const clamped = Math.min(600, Math.max(30, sec));
  return clamped * 1000;
}

function rateLimitedCalendarResponse(
  cacheKey: string,
  stale: CalendarApiPayload,
  retryAfterSec: number,
): NextResponse {
  const res = NextResponse.json({
    ...stale,
    rateLimited: true,
    calendarStale: true,
    rosterMessage:
      "データ取得の利用上限に達したため、直近に取得した内容を表示しています。1〜2分待ってから再度お試しください。",
  });
  res.headers.set("Retry-After", String(retryAfterSec));
  return res;
}

export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const calAppId = process.env.CALENDAR_APP_ID?.trim();
  if (!calAppId) {
    return NextResponse.json(
      { error: "CALENDAR_APP_ID が未設定です", disabled: true },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));
  if (
    !Number.isFinite(year) ||
    year < 1990 ||
    year > 2100 ||
    !Number.isFinite(month) ||
    month < 1 ||
    month > 12
  ) {
    return NextResponse.json(
      { error: "クエリ year（年）と month（1〜12）を指定してください" },
      { status: 400 },
    );
  }

  const extraRaw = process.env.CALENDAR_EXTRA_HOLIDAYS?.trim();
  const extraHolidayKeys = extraRaw
    ? extraRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const includeSandwich =
    process.env.CALENDAR_INCLUDE_SANDWICH_NATIONAL_HOLIDAY?.trim() === "true";

  const reportAppId = process.env.CALENDAR_REPORT_APP_ID?.trim() ?? "";
  const recordsQueryFilterDisabled =
    process.env.CALENDAR_RECORDS_QUERY_FILTER?.trim() === "false";
  const recordsQueryFilterEnabled = !recordsQueryFilterDisabled;

  const refresh =
    url.searchParams.get("refresh") === "1" ||
    url.searchParams.get("nocache") === "1";
  if (refresh) {
    invalidateCalendarPayloadCacheForMonth(year, month);
    /**
     * 材料である工事レコードのキャッシュ（既定300秒）も捨てる。
     *
     * ペイロードだけ作り直しても、材料が古ければ**同じ内容が再構築される**
     * だけで、保存した内容が最大300秒反映されなかった。
     *
     * さらにこれらのキャッシュはモジュールレベルの変数＝**プロセスごと**で、
     * Netlify は複数インスタンスで動く。保存を処理したインスタンスで
     * 無効化しても、次の GET が別インスタンスへ届けば古いままになる。
     * 「取り直す」判断は **GET を受けた側**で下さないと意味がない。
     *
     * refresh=1 を投げるのは保存直後の forceRefreshCalendar だけで、
     * 画面の手動更新からは呼ばれない。取り直しの頻度は保存の頻度に等しい。
     */
    invalidateCalendarConstructionRecordsCache();
  }

  const cacheKey = buildCalendarPayloadCacheKey(year, month);
  const calAuth = { apiKey: apiKeyForCalendarPocket() };
  const calFieldsAuth = { apiKey: apiKeyForCalendarPocket() };
  const reportFieldsAuth = { apiKey: apiKeyForCalendarReportPocket1() };

  try {
    const payload = await getOrComputeCalendarPayload(
      cacheKey,
      calendarCacheTtlMs(),
      async (): Promise<CalendarApiPayload> => {
        const constructionFields = await fetchAppFields(calAppId, calFieldsAuth, {
          operation: "calendar:工事fields",
          appEnv: "CALENDAR_APP_ID",
        });

        const fids = resolveConstructionFieldIds(constructionFields);
        const mapAddressIds =
          resolveConstructionMapAddressFieldIds(constructionFields);
        const csv = collectConstructionFieldsCsv(fids, mapAddressIds);

        const pocketQuery = recordsQueryFilterEnabled
          ? buildConstructionRecordsMonthOverlapQuery(fids, year, month)
          : undefined;

        const constructionRecords = await fetchCalendarConstructionRecordsCached(
          calAppId,
          csv,
          pocketQuery,
        );

        let reportRecords: Awaited<
          ReturnType<typeof fetchCalendarReportRecordsCached>
        > | null = null;
        let reportFields: Awaited<ReturnType<typeof fetchAppFields>> | null =
          null;

        if (reportAppId) {
          reportFields = await fetchAppFields(reportAppId, reportFieldsAuth, {
            operation: "calendar:工事報告fields",
            appEnv: "CALENDAR_REPORT_APP_ID",
          });
          const rcsv = collectReportFieldsCsv(
            resolveReportFieldIds(reportFields),
          );
          reportRecords = rcsv
            ? await fetchCalendarReportRecordsCached(reportAppId, rcsv)
            : [];
        }

        return buildCalendarPayload(
          year,
          month,
          constructionRecords,
          reportRecords,
          constructionFields,
          reportFields,
          { extraHolidayKeys, includeSandwichNationalHoliday: includeSandwich },
        );
      },
    );

    const handlerFieldId = calendarConstructionHandlerFieldIdFromEnv();
    const withHandler: CalendarApiPayload =
      handlerFieldId
        ? {
            ...payload,
            emptyFillConstructionHandlerUsesStaffDirectory:
              constructionHandlerStaffConfigReady(),
          }
        : payload;

    return NextResponse.json(withHandler);
  } catch (e) {
    console.error("[api/calendar]", e);
    if (isPocketHttpRateLimitError(e)) {
      const stale =
        getStaleCalendarPayload(cacheKey) ?? getAnyStaleCalendarPayload();
      const retrySec = Math.max(
        60,
        Math.ceil(
          Math.max(
            pocketApiRateLimitRemainingMs(calAuth),
            pocketApiRateLimitRemainingMs(reportFieldsAuth),
          ) / 1000,
        ) || calendarReportRateLimitRetryAfterSec(reportFieldsAuth),
      );
      if (stale) {
        return rateLimitedCalendarResponse(cacheKey, stale, retrySec);
      }
      return NextResponse.json(
        {
          error:
            "データ取得の利用上限に達しました。1〜2分待ってから再度お試しください。",
        },
        { status: 429, headers: { "Retry-After": String(retrySec) } },
      );
    }
    return NextResponse.json(
      {
        error:
          "カレンダーデータの取得に失敗しました。しばらくしてから再度お試しください。",
      },
      { status: 502 },
    );
  }
}
