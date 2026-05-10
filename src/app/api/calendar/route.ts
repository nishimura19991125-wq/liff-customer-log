import { NextResponse } from "next/server";

import {
  buildCalendarPayload,
  collectConstructionFieldsCsv,
  collectReportFieldsCsv,
  resolveConstructionFieldIds,
  resolveReportFieldIds,
} from "@/lib/calendar-kojo";
import {
  apiKeyForCalendarPocket,
  apiKeyForCalendarReportPocket,
  fetchAllRecordsPages,
  fetchAppFields,
} from "@/lib/atpocket";
import { resolveCallerLineUserId } from "@/lib/request-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const caller = await resolveCallerLineUserId(request);
  if (!caller) {
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

  try {
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

    const reportAppId = process.env.CALENDAR_REPORT_APP_ID?.trim();
    let reportRecords: Awaited<
      ReturnType<typeof fetchAllRecordsPages>
    > | null = null;
    let reportFields: Awaited<ReturnType<typeof fetchAppFields>> | null = null;

    if (reportAppId) {
      reportFields = await fetchAppFields(reportAppId, reportAuth);
      const rf = resolveReportFieldIds(reportFields);
      const rcsv = collectReportFieldsCsv(rf);
      if (rcsv) {
        reportRecords = await fetchAllRecordsPages(reportAppId, rcsv, reportAuth);
      }
    }

    const payload = buildCalendarPayload(
      year,
      month,
      constructionRecords,
      reportRecords,
      constructionFields,
      reportFields,
      { extraHolidayKeys, includeSandwichNationalHoliday: includeSandwich },
    );

    return NextResponse.json(payload);
  } catch (e) {
    console.error("[api/calendar]", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "カレンダーデータの取得に失敗しました", detail },
      { status: 502 },
    );
  }
}
