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
  buildCalendarPayloadCacheKey,
  getOrComputeCalendarPayload,
  invalidateCalendarPayloadCacheForMonth,
} from "@/lib/calendar-response-cache";
import {
  type AtPocketRecordRow,
  apiKeyForCalendarPocket,
  apiKeyForCalendarReportPocket,
  fetchAllRecordsPages,
  fetchAppFields,
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
  const sec = raw ? Number(raw) : 60;
  if (!Number.isFinite(sec)) return 60_000;
  const clamped = Math.min(180, Math.max(15, sec));
  return clamped * 1000;
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
  const recordsQueryFilterEnabled =
    process.env.CALENDAR_RECORDS_QUERY_FILTER?.trim() === "true";

  const refresh =
    url.searchParams.get("refresh") === "1" ||
    url.searchParams.get("nocache") === "1";
  if (refresh) {
    invalidateCalendarPayloadCacheForMonth(year, month);
  }

  const cacheKey = buildCalendarPayloadCacheKey(year, month);

  try {
    const payload = await getOrComputeCalendarPayload(
      cacheKey,
      refresh ? 0 : calendarCacheTtlMs(),
      async (): Promise<CalendarApiPayload> => {
        const calAuth = { apiKey: apiKeyForCalendarPocket() };
        const reportAuth = { apiKey: apiKeyForCalendarReportPocket() };

        const [constructionFields, reportFields] = await Promise.all([
          fetchAppFields(calAppId, calAuth),
          reportAppId
            ? fetchAppFields(reportAppId, reportAuth)
            : Promise.resolve(null),
        ]);

        const fids = resolveConstructionFieldIds(constructionFields);
        const mapAddressIds =
          resolveConstructionMapAddressFieldIds(constructionFields);
        const csv = collectConstructionFieldsCsv(fids, mapAddressIds);

        const pocketQuery =
          recordsQueryFilterEnabled
            ? buildConstructionRecordsMonthOverlapQuery(fids, year, month)
            : undefined;

        let reportRecordsPromise: Promise<AtPocketRecordRow[] | null> =
          Promise.resolve(null);

        if (reportAppId && reportFields) {
          const rf = resolveReportFieldIds(reportFields);
          const rcsv = collectReportFieldsCsv(rf);
          if (rcsv) {
            reportRecordsPromise = fetchAllRecordsPages(
              reportAppId,
              rcsv,
              reportAuth,
            );
          }
        }

        const [constructionRecords, reportRecords] = await Promise.all([
          fetchAllRecordsPages(
            calAppId,
            csv,
            calAuth,
            pocketQuery ?? undefined,
          ),
          reportRecordsPromise,
        ]);

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
    return NextResponse.json(
      {
        error:
          "カレンダーデータの取得に失敗しました。しばらくしてから再度お試しください。",
      },
      { status: 502 },
    );
  }
}
