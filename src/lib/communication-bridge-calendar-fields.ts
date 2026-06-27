import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import {
  type ConstructionFieldIds,
  pocketFieldUniqueIdByCaption,
  resolveConfiguredFieldToSchemaUniqueId,
  resolveConstructionFieldIds,
} from "@/lib/calendar-kojo";

const ATTACHMENT_CAPTION_KEYWORDS = [
  "添付画像",
  "添付ファイル",
  "添付",
  "画像",
  "ファイル",
  "写真",
];

function pickAttachmentFieldByCaption(fields: AtPocketFieldRow[]): string | null {
  for (const caption of ATTACHMENT_CAPTION_KEYWORDS) {
    const id = pocketFieldUniqueIdByCaption(fields, caption);
    if (id) return id;
  }
  const lowered = ATTACHMENT_CAPTION_KEYWORDS.map((k) => k.toLowerCase());
  for (const f of fields) {
    const cap = (f.caption ?? "").trim().toLowerCase();
    if (!cap) continue;
    if (lowered.some((k) => cap.includes(k))) {
      const id = f.uniqueId?.trim();
      if (id) return id;
    }
  }
  return null;
}

const FILE_FIELD_TYPES = new Set([
  "File",
  "Attachment",
  "Attachments",
  "Image",
  "Images",
]);

/** コミュニケーションブリッジカレンダーの添付画像列 uniqueId */
export function resolveCommunicationBridgeAttachmentFieldId(
  fields: AtPocketFieldRow[],
): string | null {
  const fromEnv =
    process.env.COMMUNICATION_BRIDGE_CALENDAR_ATTACHMENT_FIELD_ID?.trim();
  if (fromEnv) {
    return resolveConfiguredFieldToSchemaUniqueId(fromEnv, fields);
  }

  for (const f of fields) {
    if (FILE_FIELD_TYPES.has((f.fieldType ?? "").trim())) {
      const id = f.uniqueId?.trim();
      if (id) return id;
    }
  }

  return pickAttachmentFieldByCaption(fields);
}

const BRIDGE_START_DATE_KEYWORDS = [
  "日付",
  "配信日",
  "掲載日",
  "公開日",
  "カレンダー日",
  "年月日",
  "施工予定日",
  "予定日",
  "着工日",
  "工事日",
];

const BRIDGE_TITLE_KEYWORDS = [
  "タイトル",
  "件名",
  "タイトル名",
  "コメント",
  "内容",
  "お客様名",
  "顧客名",
];

const DATE_FIELD_TYPES = new Set([
  "Date",
  "Datetime",
  "DateTime",
  "date",
  "datetime",
]);

function nfkcLower(s: string): string {
  return s.normalize("NFKC").trim().toLowerCase();
}

function pickFieldByCaptionKeywords(
  fields: AtPocketFieldRow[],
  keywords: string[],
): string | null {
  const lowered = keywords.map((k) => nfkcLower(k));
  for (const f of fields) {
    const cap = nfkcLower(String(f.caption ?? ""));
    if (!cap) continue;
    if (lowered.some((k) => cap.includes(k))) {
      const id = f.uniqueId?.trim();
      if (id) return id;
    }
  }
  return null;
}

function pickFirstDateTypeField(fields: AtPocketFieldRow[]): string | null {
  for (const f of fields) {
    if (DATE_FIELD_TYPES.has((f.fieldType ?? "").trim())) {
      const id = f.uniqueId?.trim();
      if (id) return id;
    }
  }
  return null;
}

function fieldUniqueIdByCaptionExact(
  fields: AtPocketFieldRow[],
  caption: string,
): string | null {
  return pocketFieldUniqueIdByCaption(fields, caption);
}

/** @pocket query に使える日付列か */
export function isCommunicationBridgeDateFieldForQuery(
  fields: AtPocketFieldRow[],
  fieldId: string | null | undefined,
): boolean {
  const id = fieldId?.trim();
  if (!id) return false;
  for (const f of fields) {
    if (f.uniqueId?.trim() !== id) continue;
    if (DATE_FIELD_TYPES.has((f.fieldType ?? "").trim())) return true;
    const cap = nfkcLower(String(f.caption ?? ""));
    return /日|date|年月|配信|掲載|公開|予定|着工|工事|カレンダー|ymd/i.test(
      cap,
    );
  }
  return false;
}

/** コミュニケーションブリッジカレンダーの日付・タイトル列（工事カレンダー用推定より優先） */
export function resolveCommunicationBridgeCalendarFieldIds(
  fields: AtPocketFieldRow[],
): ConstructionFieldIds {
  const base = resolveConstructionFieldIds(fields);

  const startFromEnv =
    process.env.COMMUNICATION_BRIDGE_CALENDAR_START_DATE_FIELD_ID?.trim();
  const startDate =
    (startFromEnv
      ? resolveConfiguredFieldToSchemaUniqueId(startFromEnv, fields)
      : null) ??
    fieldUniqueIdByCaptionExact(fields, "日付") ??
    pickFirstDateTypeField(fields) ??
    pickFieldByCaptionKeywords(fields, BRIDGE_START_DATE_KEYWORDS) ??
    base.startDate?.trim() ??
    "";

  const titleFromEnv =
    process.env.COMMUNICATION_BRIDGE_CALENDAR_TITLE_FIELD_ID?.trim();
  const title =
    (titleFromEnv
      ? resolveConfiguredFieldToSchemaUniqueId(titleFromEnv, fields)
      : null) ??
    pocketFieldUniqueIdByCaption(fields, "タイトル") ??
    pickFieldByCaptionKeywords(fields, BRIDGE_TITLE_KEYWORDS) ??
    base.title ??
    "";

  return {
    ...base,
    title,
    startDate,
    endDate: "",
    shigumi: "",
    panelWork: "",
    electricWork: "",
    appSettingsDay: "",
    zankoDay: "",
    housingStatus: "",
  };
}
