import { NextResponse } from "next/server";

import type { CalendarApiPayload } from "@/lib/calendar-api-types";
import {
  buildCalendarPayload,
  buildConstructionRecordsMonthOverlapQuery,
  collectConstructionFieldsCsv,
  resolveConstructionFieldIds,
} from "@/lib/calendar-kojo";
import { resolveConstructionMapAddressFieldIds } from "@/lib/map-address-fields";
import { fetchCommunicationBridgeCalendarRecordsCached } from "@/lib/communication-bridge-calendar-records-cache";
import {
  buildCommunicationBridgeCalendarPayloadCacheKey,
  communicationBridgeCalendarCacheTtlMs,
  resolveCommunicationBridgeCalendarAppId,
} from "@/lib/communication-bridge-calendar";
import {
  getAnyStaleCalendarPayload,
  getOrComputeCalendarPayload,
  getStaleCalendarPayload,
  invalidateCalendarPayloadCacheForMonth,
} from "@/lib/calendar-response-cache";
import {
  apiKeyForCommunicationBridgeCalendarPocket,
  fetchAppFields,
  isPocketHttpRateLimitError,
  pocketApiRateLimitRemainingMs,
} from "@/lib/atpocket";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

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

  const resolved = await resolveCommunicationBridgeCalendarAppId();
  if (!resolved.appId) {
    return NextResponse.json(
      {
        error: resolved.error ?? "COMMUNICATION_BRIDGE_CALENDAR_APP_ID が未設定です",
        disabled: true,
      },
      { status: 503 },
    );
  }

  const calAppId = resolved.appId;

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

  const extraRaw =
    process.env.COMMUNICATION_BRIDGE_CALENDAR_EXTRA_HOLIDAYS?.trim() ??
    process.env.CALENDAR_EXTRA_HOLIDAYS?.trim();
  const extraHolidayKeys = extraRaw
    ? extraRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const includeSandwich =
    process.env.COMMUNICATION_BRIDGE_CALENDAR_INCLUDE_SANDWICH_NATIONAL_HOLIDAY?.trim() ===
      "true" ||
    process.env.CALENDAR_INCLUDE_SANDWICH_NATIONAL_HOLIDAY?.trim() === "true";

  const recordsQueryFilterDisabled =
    process.env.COMMUNICATION_BRIDGE_CALENDAR_RECORDS_QUERY_FILTER?.trim() ===
      "false" || process.env.CALENDAR_RECORDS_QUERY_FILTER?.trim() === "false";
  const recordsQueryFilterEnabled = !recordsQueryFilterDisabled;

  const refresh =
    url.searchParams.get("refresh") === "1" ||
    url.searchParams.get("nocache") === "1";
  if (refresh) {
    invalidateCalendarPayloadCacheForMonth(year, month);
  }

  const cacheKey = buildCommunicationBridgeCalendarPayloadCacheKey(
    year,
    month,
    calAppId,
  );
  const calAuth = { apiKey: apiKeyForCommunicationBridgeCalendarPocket() };

  try {
    const payload = await getOrComputeCalendarPayload(
      cacheKey,
      communicationBridgeCalendarCacheTtlMs(),
      async (): Promise<CalendarApiPayload> => {
        const constructionFields = await fetchAppFields(calAppId, calAuth, {
          operation: "communication-bridge-calendar:fields",
          appEnv: "COMMUNICATION_BRIDGE_CALENDAR_APP_ID",
        });

        const fids = resolveConstructionFieldIds(constructionFields);
        const mapAddressIds =
          resolveConstructionMapAddressFieldIds(constructionFields);
        const csv = collectConstructionFieldsCsv(fids, mapAddressIds);

        const pocketQuery = recordsQueryFilterEnabled
          ? buildConstructionRecordsMonthOverlapQuery(fids, year, month)
          : undefined;

        const constructionRecords =
          await fetchCommunicationBridgeCalendarRecordsCached(
            calAppId,
            csv,
            pocketQuery,
          );

        return buildCalendarPayload(
          year,
          month,
          constructionRecords,
          null,
          constructionFields,
          null,
          { extraHolidayKeys, includeSandwichNationalHoliday: includeSandwich },
        );
      },
    );

    return NextResponse.json(payload);
  } catch (e) {
    console.error("[api/communication-bridge/calendar]", e);
    if (isPocketHttpRateLimitError(e)) {
      const stale =
        getStaleCalendarPayload(cacheKey) ?? getAnyStaleCalendarPayload();
      const retrySec = Math.max(
        60,
        Math.ceil(pocketApiRateLimitRemainingMs(calAuth) / 1000) || 60,
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
