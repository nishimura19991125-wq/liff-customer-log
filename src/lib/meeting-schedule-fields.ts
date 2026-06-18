import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import {
  pocketFieldUniqueIdByCaption,
  resolveConfiguredFieldToSchemaUniqueId,
} from "@/lib/calendar-kojo";

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

function pickByKeywords(
  fields: AtPocketFieldRow[],
  keywords: string[],
): string | null {
  const lowered = keywords.map((k) => nfkc(k).toLowerCase()).filter(Boolean);
  for (const f of fields) {
    const cap = f.caption ? nfkc(String(f.caption)).toLowerCase() : "";
    if (!cap) continue;
    if (lowered.some((k) => cap.includes(k))) {
      const id = f.uniqueId?.trim();
      if (id) return id;
    }
  }
  return null;
}

function pickByEnvOrKeywords(
  envKey: string,
  fields: AtPocketFieldRow[],
  keywords: string[],
  exactCaptions: string[] = [],
): string | null {
  const env = process.env[envKey]?.trim();
  if (env) {
    const id = resolveConfiguredFieldToSchemaUniqueId(env, fields);
    if (id) return id;
  }
  for (const cap of exactCaptions) {
    const id = pocketFieldUniqueIdByCaption(fields, cap);
    if (id) return id;
  }
  return pickByKeywords(fields, keywords);
}

export type MeetingScheduleFieldMap = {
  clPerson: string;
  salesperson: string | null;
  scheduledDate: string;
  customerName: string | null;
  city: string | null;
  meetingTime: string | null;
  estimateStatus: string | null;
  apoType: string | null;
  meetingPlace: string | null;
  /** 初回商談実施日など（返待ち・再商談の日付判定用） */
  meetingDate: string | null;
  closeType: string | null;
};

export function meetingScheduleCloseTypeOptions(): string[] {
  const raw = process.env.MEETING_SCHEDULE_CLOSE_TYPE_OPTIONS?.trim();
  if (raw) {
    const parsed = raw
      .split(",")
      .map((s) => nfkc(s))
      .filter(Boolean);
    if (parsed.length) return parsed;
  }
  return ["片クロ", "両クロ"];
}

export function meetingScheduleMeetingPlaceOptions(): string[] {
  const raw = process.env.MEETING_SCHEDULE_MEETING_PLACE_OPTIONS?.trim();
  if (raw) {
    const parsed = raw
      .split(",")
      .map((s) => nfkc(s))
      .filter(Boolean);
    if (parsed.length) return parsed;
  }
  return ["宅内テーブル商談", "宅内玄関商談", "宅外商談", "オンライン商談"];
}

export function resolveMeetingScheduleFieldMap(
  fields: AtPocketFieldRow[],
): MeetingScheduleFieldMap | null {
  const clPerson = pickByEnvOrKeywords(
    "MEETING_SCHEDULE_CL_PERSON_FIELD_ID",
    fields,
    ["CL担当者", "CL 担当者"],
    ["CL担当者"],
  );
  const scheduledDate = pickByEnvOrKeywords(
    "MEETING_SCHEDULE_DATE_FIELD_ID",
    fields,
    ["商談・資料送付予定日時", "商談資料送付予定日時"],
    ["商談・資料送付予定日時"],
  );
  if (!clPerson || !scheduledDate) return null;

  const salesperson = pickByEnvOrKeywords(
    "MEETING_SCHEDULE_AP_PERSON_FIELD_ID",
    fields,
    ["AP担当者", "AP 担当者", "アポインター", "アポ担当者"],
    ["AP担当者", "AP 担当者"],
  );

  const customerName = pickByEnvOrKeywords(
    "MEETING_SCHEDULE_CUSTOMER_NAME_FIELD_ID",
    fields,
    ["お客様名", "顧客氏名", "顧客名", "お客様"],
    ["お客様名"],
  );
  const city = pickByEnvOrKeywords(
    "MEETING_SCHEDULE_CITY_FIELD_ID",
    fields,
    ["市区郡", "市区町村", "市", "住所", "都道府県", "エリア", "地域", "訪問先"],
    ["市区郡"],
  );
  const meetingTime = pickByEnvOrKeywords(
    "MEETING_SCHEDULE_TIME_FIELD_ID",
    fields,
    [
      "商談予定時刻",
      "商談時刻",
      "予定時刻",
      "開始時刻",
      "商談時間",
      "時間",
    ],
  );
  const estimateStatus = pickByEnvOrKeywords(
    "MEETING_SCHEDULE_STATUS_FIELD_ID",
    fields,
    ["見積ステータス", "見積ｽﾃｰﾀｽ", "見積ステータス区分"],
    ["見積ステータス"],
  );
  const apoType = pickByEnvOrKeywords(
    "MEETING_SCHEDULE_APO_TYPE_FIELD_ID",
    fields,
    ["アポ種別", "アポタイプ", "種別", "導入経緯"],
    ["アポ種別"],
  );
  const meetingPlace = pickByEnvOrKeywords(
    "MEETING_SCHEDULE_PLACE_FIELD_ID",
    fields,
    ["商談場所"],
    ["商談場所"],
  );
  const meetingDate = pickByEnvOrKeywords(
    "MEETING_SCHEDULE_MEETING_DATE_FIELD_ID",
    fields,
    ["初回商談実施日"],
    ["初回商談実施日"],
  );
  const closeType = pickByEnvOrKeywords(
    "MEETING_SCHEDULE_CLOSE_TYPE_FIELD_ID",
    fields,
    ["片クロor両クロ", "片クロ", "両クロ"],
    ["片クロor両クロ"],
  );

  return {
    clPerson,
    salesperson: salesperson ?? null,
    scheduledDate,
    customerName,
    city,
    meetingTime,
    estimateStatus,
    apoType,
    meetingPlace,
    meetingDate,
    closeType,
  };
}

/** ranking_pt_dashboard.config.js MEETING_SCHEDULE_STATUSES 相当 */
export function meetingScheduleAllowedStatuses(): string[] {
  const raw = process.env.MEETING_SCHEDULE_STATUSES?.trim();
  if (raw) {
    const parsed = raw
      .split(",")
      .map((s) => nfkc(s))
      .filter(Boolean);
    if (parsed.length) return parsed;
  }
  return [
    "新規",
    "見積依頼済み",
    "見積依頼済（資料のみ）",
    "商談日調整中",
    "商談セット作成済み",
    "再商談日調整中",
    "資料送付済",
    "再商談",
    "返待ち",
  ];
}

export function meetingScheduleExcludedStatuses(): string[] {
  const raw = process.env.MEETING_SCHEDULE_EXCLUDED_STATUSES?.trim();
  if (raw) {
    const parsed = raw
      .split(",")
      .map((s) => nfkc(s))
      .filter(Boolean);
    if (parsed.length) return parsed;
  }
  return ["再商談否", "再商談成約", "返待ち否", "返待ち成約"];
}

/** LIFF から変更可能な見積ステータス（省略時は表示対象 + 成約/否系など） */
export function meetingScheduleEditableStatuses(): string[] {
  const raw = process.env.MEETING_SCHEDULE_EDITABLE_STATUSES?.trim();
  if (raw) {
    const parsed = raw
      .split(",")
      .map((s) => nfkc(s))
      .filter(Boolean);
    if (parsed.length) return parsed;
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const status of [
    ...meetingScheduleAllowedStatuses(),
    ...meetingScheduleExcludedStatuses(),
    "即決成約",
    "アポキャン",
    "否",
  ]) {
    if (seen.has(status)) continue;
    seen.add(status);
    out.push(status);
  }
  return out;
}

export function meetingScheduleImportKeySourceFieldIds(): string[] {
  const raw = process.env.MEETING_SCHEDULE_IMPORT_KEY_SOURCE_FIELD_IDS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => nfkc(s))
    .filter(Boolean);
}

/** アポ取得情報連携の取込キー（アポ通番(仮) 等）。PUT 更新時に必須 */
export function resolveMeetingScheduleImportKeyFieldId(
  fields: AtPocketFieldRow[],
): string | null {
  const env = process.env.MEETING_SCHEDULE_IMPORT_KEY_FIELD_ID?.trim();
  if (env) {
    const id = resolveConfiguredFieldToSchemaUniqueId(env, fields);
    if (id) return id;
  }
  for (const cap of ["アポ通番(仮)", "アポ通番（仮）", "アポ通番"]) {
    const id = pocketFieldUniqueIdByCaption(fields, cap);
    if (id) return id;
  }
  return pickByKeywords(fields, ["アポ通番(仮)", "アポ通番（仮）", "アポ通番"]);
}
