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
import type {
  AtPocketFetchAuth,
  AtPocketFieldRow,
  AtPocketRecordRow,
} from "@/lib/atpocket";
import { fetchCalendarReportRecordsCached } from "@/lib/calendar-report-records-cache";
import {
  apiKeyForCalendarReportPocket1,
  fetchAppFields,
  fetchRecordById,
  isPocketHttpRateLimitError,
  listAuthsForAppList,
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

function calendarRecordReadOptions(preferred?: AtPocketFetchAuth) {
  const listAuths = listAuthsForAppList("CALENDAR");
  const preferredKey = preferred?.apiKey?.trim();
  const authKeys =
    preferredKey && !listAuths.some((a) => a.apiKey === preferredKey)
      ? [{ apiKey: preferredKey }, ...listAuths]
      : listAuths.length > 0
        ? listAuths
        : preferred
          ? [preferred]
          : undefined;
  return {
    maxRetries: 1,
    ...(authKeys && authKeys.length >= 2 ? { authKeys } : {}),
  };
}

/** 保存後のレコードを再取得し、表示月のカレンダー差分を組み立てる */
export async function buildCalendarPatchAfterConstructionSave(
  calAppId: string,
  constructionRecordId: string,
  pocketAuth: AtPocketFetchAuth,
  viewYearRaw: unknown,
  viewMonthRaw: unknown,
  options?: {
    /** 直前に取得済みの列定義（再 GET /fields を避ける） */
    constructionFields?: AtPocketFieldRow[];
  },
): Promise<CalendarRecordMonthPatch | null> {
  const ym = parseViewYearMonth(viewYearRaw, viewMonthRaw);
  if (!ym) return null;

  try {
    const calFields =
      options?.constructionFields ??
      (await fetchAppFields(calAppId, pocketAuth));
    const fids = resolveConstructionFieldIds(calFields);
    const mapAddressIds = resolveConstructionMapAddressFieldIds(calFields);
    const csv = collectConstructionFieldsCsv(fids, mapAddressIds);
    const readOpts = calendarRecordReadOptions(pocketAuth);

    let row: AtPocketRecordRow | null = null;
    try {
      row = await fetchRecordById(
        calAppId,
        constructionRecordId,
        pocketAuth,
        csv,
        readOpts,
      );
    } catch (e) {
      if (isPocketHttpRateLimitError(e)) {
        console.warn(
          "[calendar-record-patch] skip patch after 429 on fields GET",
        );
        return null;
      }
      throw e;
    }
    if (!row?.record) {
      try {
        row = await fetchRecordById(
          calAppId,
          constructionRecordId,
          pocketAuth,
          undefined,
          readOpts,
        );
      } catch (e) {
        if (isPocketHttpRateLimitError(e)) {
          console.warn(
            "[calendar-record-patch] skip patch after 429 on full GET",
          );
          return null;
        }
        throw e;
      }
    }
    if (!row) return null;

    const reportAppId = process.env.CALENDAR_REPORT_APP_ID?.trim() ?? "";
    let reportRecords: AtPocketRecordRow[] | null = null;
    let reportFields: Awaited<ReturnType<typeof fetchAppFields>> | null = null;
    if (reportAppId) {
      const reportFieldsAuth = {
        apiKey: apiKeyForCalendarReportPocket1(),
      };
      try {
        reportFields = await fetchAppFields(reportAppId, reportFieldsAuth, {
          operation: "calendar:工事報告fields(patch)",
          appEnv: "CALENDAR_REPORT_APP_ID",
        });
        const rcsv = collectReportFieldsCsv(resolveReportFieldIds(reportFields));
        reportRecords = rcsv
          ? await fetchCalendarReportRecordsCached(reportAppId, rcsv)
          : [];
      } catch (e) {
        if (isPocketHttpRateLimitError(e)) {
          console.warn(
            "[calendar-record-patch] report fetch rate-limited; patch without reports",
          );
          reportRecords = [];
          reportFields = null;
        } else {
          throw e;
        }
      }
    }

    return buildCalendarMonthPatchForConstructionRecord(
      ym.year,
      ym.month,
      row,
      calFields,
      reportRecords,
      reportFields,
    );
  } catch (e) {
    if (isPocketHttpRateLimitError(e)) {
      console.warn("[calendar-record-patch] skip patch after 429");
      return null;
    }
    throw e;
  }
}
