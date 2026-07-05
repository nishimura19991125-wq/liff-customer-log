import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

/** 稼働終了報告の報告者列（@pocket field-52）。旧「報告者（旧）」列は使わない。 */
export const WORK_END_REPORT_REPORTER_FIELD_DEFAULT = "field-52";

function pickFieldUniqueIdByExactCaption(
  fields: AtPocketFieldRow[],
  caption: string,
  options?: { excludeLegacy?: boolean },
): string | null {
  const target = nfkc(caption).toLowerCase();
  for (const f of fields) {
    const cap = f.caption ? nfkc(String(f.caption)).toLowerCase() : "";
    if (!cap || cap !== target) continue;
    if (
      options?.excludeLegacy &&
      (cap.includes("旧") || cap.includes("(旧)"))
    ) {
      continue;
    }
    const id = f.uniqueId?.trim();
    return id || null;
  }
  return null;
}

function pickFieldUniqueIdByCaptions(
  fields: AtPocketFieldRow[],
  captions: string[],
  options?: { excludeLegacy?: boolean },
): string | null {
  for (const caption of captions) {
    const id = pickFieldUniqueIdByExactCaption(fields, caption, options);
    if (id) return id;
  }
  return null;
}

function resolveSchemaFieldId(
  configuredId: string | undefined,
  fields: AtPocketFieldRow[],
  captionAlts: string[],
  captionOptions?: { excludeLegacy?: boolean },
): string | null {
  const fromEnv = configuredId?.trim();
  if (fromEnv) {
    return resolveConfiguredFieldToSchemaUniqueId(fromEnv, fields);
  }
  const picked = pickFieldUniqueIdByCaptions(
    fields,
    captionAlts,
    captionOptions,
  );
  if (!picked) return null;
  return resolveConfiguredFieldToSchemaUniqueId(picked, fields) ?? picked;
}

export type WorkEndReportFieldIds = {
  reporter: string | null;
  pinponCount: string | null;
  meetingCount: string | null;
  apoCount: string | null;
  apoActivity: string | null;
  reportDate: string | null;
  workArea: string | null;
};

export function resolveWorkEndReportFieldIds(
  appFields: AtPocketFieldRow[],
): WorkEndReportFieldIds {
  return {
    reporter: resolveSchemaFieldId(
      process.env.WORK_END_REPORT_REPORTER_FIELD_ID ??
        process.env.WORK_END_REPORT_STAFF_NAME_FIELD_ID ??
        WORK_END_REPORT_REPORTER_FIELD_DEFAULT,
      appFields,
      ["報告者", "社員名", "担当者", "氏名"],
      { excludeLegacy: true },
    ),
    pinponCount: resolveSchemaFieldId(
      process.env.WORK_END_REPORT_PINPON_COUNT_FIELD_ID,
      appFields,
      ["ピンポン数", "ピンポン 数"],
    ),
    meetingCount: resolveSchemaFieldId(
      process.env.WORK_END_REPORT_MEETING_COUNT_FIELD_ID,
      appFields,
      ["面談数", "面談 数"],
    ),
    apoCount: resolveSchemaFieldId(
      process.env.WORK_END_REPORT_APO_COUNT_FIELD_ID,
      appFields,
      ["アポ獲得数", "アポ 獲得数", "アポ取得数"],
    ),
    apoActivity: resolveSchemaFieldId(
      process.env.WORK_END_REPORT_APO_ACTIVITY_FIELD_ID,
      appFields,
      ["アポ活動実施", "アポ 活動実施", "AP活動実施"],
    ),
    reportDate: resolveSchemaFieldId(
      process.env.WORK_END_REPORT_DATE_FIELD_ID,
      appFields,
      ["報告日", "日付"],
    ),
    workArea: resolveSchemaFieldId(
      process.env.WORK_END_REPORT_WORK_AREA_FIELD_ID,
      appFields,
      ["稼働エリア", "稼働 エリア", "エリア"],
    ),
  };
}

export function workEndReportFieldsConfigured(
  ids: WorkEndReportFieldIds,
): boolean {
  return Boolean(
    ids.reporter &&
      ids.reportDate &&
      ids.pinponCount &&
      ids.meetingCount &&
      ids.apoCount &&
      ids.apoActivity &&
      ids.workArea,
  );
}

export function workEndReportFieldsCsv(ids: WorkEndReportFieldIds): string {
  const parts = [
    ids.reporter,
    ids.pinponCount,
    ids.meetingCount,
    ids.apoCount,
    ids.apoActivity,
    ids.reportDate,
    ids.workArea,
  ].filter((id): id is string => Boolean(id?.trim()));
  return [...new Set(parts)].join(",");
}
