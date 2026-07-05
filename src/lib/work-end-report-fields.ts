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

function resolveFieldIdFromEnv(
  envKeys: readonly string[],
  defaultId: string | undefined,
  fields: AtPocketFieldRow[],
): string | null {
  for (const envKey of envKeys) {
    const raw = process.env[envKey]?.trim();
    if (!raw) continue;
    const resolved = resolveConfiguredFieldToSchemaUniqueId(raw, fields);
    if (resolved) return resolved;
  }
  if (defaultId?.trim()) {
    return resolveConfiguredFieldToSchemaUniqueId(defaultId.trim(), fields);
  }
  return null;
}

export function resolveWorkEndReportFieldIds(
  appFields: AtPocketFieldRow[],
): WorkEndReportFieldIds {
  return {
    reporter: resolveFieldIdFromEnv(
      WORK_END_REPORT_FIELD_ENV_KEYS.reporter,
      undefined,
      appFields,
    ),
    pinponCount: resolveFieldIdFromEnv(
      WORK_END_REPORT_FIELD_ENV_KEYS.pinponCount,
      undefined,
      appFields,
    ),
    meetingCount: resolveFieldIdFromEnv(
      WORK_END_REPORT_FIELD_ENV_KEYS.meetingCount,
      undefined,
      appFields,
    ),
    apoCount: resolveFieldIdFromEnv(
      WORK_END_REPORT_FIELD_ENV_KEYS.apoCount,
      undefined,
      appFields,
    ),
    apoActivity: resolveFieldIdFromEnv(
      WORK_END_REPORT_FIELD_ENV_KEYS.apoActivity,
      undefined,
      appFields,
    ),
    reportDate: resolveFieldIdFromEnv(
      WORK_END_REPORT_FIELD_ENV_KEYS.reportDate,
      undefined,
      appFields,
    ),
    workArea: resolveFieldIdFromEnv(
      WORK_END_REPORT_FIELD_ENV_KEYS.workArea,
      undefined,
      appFields,
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
