import { NextResponse } from "next/server";

import type { CalendarApiPayload } from "@/lib/calendar-api-types";
import {
  buildCalendarPayload,
  collectConstructionFieldsCsv,
  collectReportFieldsCsv,
  resolveConstructionFieldIds,
  resolveReportFieldIds,
} from "@/lib/calendar-kojo";
import { getOrComputeCalendarPayload } from "@/lib/calendar-response-cache";
import {
  apiKeyForCalendarPocket,
  apiKeyForCalendarReportPocket,
  fetchAllRecordsPages,
  fetchAppFields,
} from "@/lib/atpocket";
import { resolveCallerLineUserId } from "@/lib/request-auth";

export const dynamic = "force-dynamic";

function calendarCacheTtlMs(): number {
  const raw = process.env.CALENDAR_RESPONSE_CACHE_SECONDS?.trim();
  const sec = raw ? Number(raw) : 60;
  if (!Number.isFinite(sec)) return 60_000;
  const clamped = Math.min(180, Math.max(15, sec));
  return clamped * 1000;
}

export async function GET(request: Request) {
  if (!(await resolveCallerLineUserId(request))) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

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

  /** 認証済みユーザー間で同一の組織カレンダーを共有する前提のキャッシュキー（ユーザー ID は含めない） */
  const cacheKey = JSON.stringify({
    v: 2,
    calAppId,
    reportAppId,
    extra: extraHolidayKeys.slice().sort().join(","),
    sandwich: includeSandwich,
    year,
    month,
  });

  try {
    const payload = await getOrComputeCalendarPayload(
      cacheKey,
      calendarCacheTtlMs(),
      async (): Promise<CalendarApiPayload> => {
        const calAuth = { apiKey: apiKeyForCalendarPocket() };
        const reportAuth = { apiKey: apiKeyForCalendarReportPocket() };

        const constructionFields = await fetchAppFields(calAppId, calAuth);
        const fids = resolveConstructionFieldIds(constructionFields);
        const csv = collectConstructionFieldsCsv(fids);
        const constructionRecords = await fetchAllRecordsPages(
          calAppId,
          csv,
          calAuth,
        );

        let reportRecords: Awaited<
          ReturnType<typeof fetchAllRecordsPages>
        > | null = null;
        let reportFields: Awaited<ReturnType<typeof fetchAppFields>> | null =
          null;

        if (reportAppId) {
          reportFields = await fetchAppFields(reportAppId, reportAuth);
          const rf = resolveReportFieldIds(reportFields);
          const rcsv = collectReportFieldsCsv(rf);
          if (rcsv) {
            reportRecords = await fetchAllRecordsPages(
              reportAppId,
              rcsv,
              reportAuth,
            );
          }
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

    return NextResponse.json(payload);
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
