import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";

export const WORK_END_REPORT_FIELD_ENV_KEYS = {
  reporter: [
    "WORK_END_REPORT_REPORTER_FIELD_ID",
    "WORK_END_REPORT_STAFF_NAME_FIELD_ID",
  ],
  pinponCount: ["WORK_END_REPORT_PINPON_COUNT_FIELD_ID"],
  meetingCount: ["WORK_END_REPORT_MEETING_COUNT_FIELD_ID"],
  apoCount: ["WORK_END_REPORT_APO_COUNT_FIELD_ID"],
  apoActivity: ["WORK_END_REPORT_APO_ACTIVITY_FIELD_ID"],
  reportDate: ["WORK_END_REPORT_DATE_FIELD_ID"],
  workArea: ["WORK_END_REPORT_WORK_AREA_FIELD_ID"],
} as const satisfies Record<string, readonly string[]>;

export type WorkEndReportFieldIds = {
  reporter: string | null;
  pinponCount: string | null;
  meetingCount: string | null;
  apoCount: string | null;
  apoActivity: string | null;
  reportDate: string | null;
  workArea: string | null;
};

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

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

function resolveFieldId(
  envKeys: readonly string[],
  fields: AtPocketFieldRow[],
  captionAlts: string[],
  captionOptions?: { excludeLegacy?: boolean },
): string | null {
  for (const envKey of envKeys) {
    const raw = process.env[envKey]?.trim();
    if (!raw) continue;
    const resolved = resolveConfiguredFieldToSchemaUniqueId(raw, fields);
    if (resolved) return resolved;
  }

  const picked = pickFieldUniqueIdByCaptions(
    fields,
    captionAlts,
    captionOptions,
  );
  if (!picked) return null;
  return resolveConfiguredFieldToSchemaUniqueId(picked, fields) ?? picked;
}

export function resolveWorkEndReportFieldIds(
  appFields: AtPocketFieldRow[],
): WorkEndReportFieldIds {
  return {
    reporter: resolveFieldId(
      WORK_END_REPORT_FIELD_ENV_KEYS.reporter,
      appFields,
      ["報告者", "社員名", "担当者", "氏名"],
      { excludeLegacy: true },
    ),
    pinponCount: resolveFieldId(
      WORK_END_REPORT_FIELD_ENV_KEYS.pinponCount,
      appFields,
      ["ピンポン数", "ピンポン 数"],
    ),
    meetingCount: resolveFieldId(
      WORK_END_REPORT_FIELD_ENV_KEYS.meetingCount,
      appFields,
      ["面談数", "面談 数"],
    ),
    apoCount: resolveFieldId(
      WORK_END_REPORT_FIELD_ENV_KEYS.apoCount,
      appFields,
      ["アポ獲得数", "アポ 獲得数", "アポ取得数"],
    ),
    apoActivity: resolveFieldId(
      WORK_END_REPORT_FIELD_ENV_KEYS.apoActivity,
      appFields,
      ["アポ活動実施", "アポ 活動実施", "AP活動実施"],
    ),
    reportDate: resolveFieldId(
      WORK_END_REPORT_FIELD_ENV_KEYS.reportDate,
      appFields,
      ["報告日", "日付"],
    ),
    workArea: resolveFieldId(
      WORK_END_REPORT_FIELD_ENV_KEYS.workArea,
      appFields,
      ["稼働エリア", "稼働 エリア", "エリア"],
    ),
  };
}

const FIELD_ENV_PRIMARY: Record<keyof WorkEndReportFieldIds, string> = {
  reporter: WORK_END_REPORT_FIELD_ENV_KEYS.reporter[0]!,
  pinponCount: WORK_END_REPORT_FIELD_ENV_KEYS.pinponCount[0]!,
  meetingCount: WORK_END_REPORT_FIELD_ENV_KEYS.meetingCount[0]!,
  apoCount: WORK_END_REPORT_FIELD_ENV_KEYS.apoCount[0]!,
  apoActivity: WORK_END_REPORT_FIELD_ENV_KEYS.apoActivity[0]!,
  reportDate: WORK_END_REPORT_FIELD_ENV_KEYS.reportDate[0]!,
  workArea: WORK_END_REPORT_FIELD_ENV_KEYS.workArea[0]!,
};

/** 環境変数も見出し解決もできなかった列の env キー */
export function workEndReportMissingFieldEnvKeys(
  ids: WorkEndReportFieldIds,
): string[] {
  return (Object.keys(FIELD_ENV_PRIMARY) as Array<keyof WorkEndReportFieldIds>)
    .filter((key) => !ids[key]?.trim())
    .map((key) => FIELD_ENV_PRIMARY[key]);
}

export function workEndReportFieldsConfigured(
  ids: WorkEndReportFieldIds,
): boolean {
  return workEndReportMissingFieldEnvKeys(ids).length === 0;
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
