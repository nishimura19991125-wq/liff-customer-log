import "server-only";

import {
  buildCalendarMonthPatchForConstructionRecord,
  collectConstructionFieldsCsv,
  collectReportFieldsCsv,
  resolveConstructionFieldIds,
  resolveReportFieldIds,
} from "@/lib/calendar-kojo";
import { resolveConstructionMapAddressFieldIds } from "@/lib/map-address-fields";
import type { CalendarRecordMonthPatch } from "@/lib/calendar-api-types";
import type { AtPocketFetchAuth, AtPocketRecordRow } from "@/lib/atpocket";
import { fetchCalendarReportRecordsCached } from "@/lib/calendar-report-records-cache";
import {
  apiKeyForCalendarReportPocket1,
  fetchAppFields,
  fetchRecordById,
} from "@/lib/atpocket";

function parseViewYearMonth(
  yearRaw: unknown,
  monthRaw: unknown,
): { year: number; month: number } | null {
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (
    !Number.isFinite(year) ||
    year < 1990 ||
    year > 2100 ||
    !Number.isFinite(month) ||
    month < 1 ||
    month > 12
  ) {
    return null;
  }
  return { year, month };
}

/** 保存後のレコードを再取得し、表示月のカレンダー差分を組み立てる */
export async function buildCalendarPatchAfterConstructionSave(
  calAppId: string,
  constructionRecordId: string,
  pocketAuth: AtPocketFetchAuth,
  viewYearRaw: unknown,
  viewMonthRaw: unknown,
): Promise<CalendarRecordMonthPatch | null> {
  const ym = parseViewYearMonth(viewYearRaw, viewMonthRaw);
  if (!ym) return null;

  const calFields = await fetchAppFields(calAppId, pocketAuth);
  const fids = resolveConstructionFieldIds(calFields);
  const mapAddressIds = resolveConstructionMapAddressFieldIds(calFields);
  const csv = collectConstructionFieldsCsv(fids, mapAddressIds);

  let row = await fetchRecordById(
    calAppId,
    constructionRecordId,
    pocketAuth,
    csv,
  );
  if (!row?.record) {
    row = await fetchRecordById(calAppId, constructionRecordId, pocketAuth);
  }
  if (!row) return null;

  const reportAppId = process.env.CALENDAR_REPORT_APP_ID?.trim() ?? "";
  let reportRecords: AtPocketRecordRow[] | null = null;
  let reportFields: Awaited<ReturnType<typeof fetchAppFields>> | null = null;
  if (reportAppId) {
    const reportFieldsAuth = {
      apiKey: apiKeyForCalendarReportPocket1(),
    };
    reportFields = await fetchAppFields(reportAppId, reportFieldsAuth, {
      operation: "calendar:工事報告fields(patch)",
      appEnv: "CALENDAR_REPORT_APP_ID",
    });
    const rcsv = collectReportFieldsCsv(resolveReportFieldIds(reportFields));
    reportRecords = rcsv
      ? await fetchCalendarReportRecordsCached(reportAppId, rcsv)
      : [];
  }

  return buildCalendarMonthPatchForConstructionRecord(
    ym.year,
    ym.month,
    row,
    calFields,
    reportRecords,
    reportFields,
  );
}
