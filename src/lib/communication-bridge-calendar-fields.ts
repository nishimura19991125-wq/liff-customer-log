import "server-only";

import type { AtPocketFieldRow, AtPocketRecordRow } from "@/lib/atpocket";
import { parseAtPocketFileField } from "@/lib/at-pocket-file-field";
import {
  type ConstructionFieldIds,
  pocketFieldUniqueIdByCaption,
  resolveConfiguredFieldToSchemaUniqueId,
} from "@/lib/calendar-kojo";

export const COMMUNICATION_BRIDGE_DATE_CAPTION = "日付";
export const COMMUNICATION_BRIDGE_ATTACHMENT_CAPTION = "添付ファイル";

export type CommunicationBridgeFieldIds = {
  dateFieldId: string | null;
  attachmentFieldId: string | null;
};

function resolveFieldByCaptionOrEnv(
  fields: AtPocketFieldRow[],
  envName: string,
  caption: string,
): string | null {
  const fromEnv = process.env[envName]?.trim();
  if (fromEnv) {
    return resolveConfiguredFieldToSchemaUniqueId(fromEnv, fields);
  }
  return pocketFieldUniqueIdByCaption(fields, caption);
}

/** コミュニケーションブリッジは「日付」「添付ファイル」列のみ使用 */
export function resolveCommunicationBridgeFieldIds(
  fields: AtPocketFieldRow[],
): CommunicationBridgeFieldIds {
  return {
    dateFieldId: resolveFieldByCaptionOrEnv(
      fields,
      "COMMUNICATION_BRIDGE_CALENDAR_START_DATE_FIELD_ID",
      COMMUNICATION_BRIDGE_DATE_CAPTION,
    ),
    attachmentFieldId: resolveFieldByCaptionOrEnv(
      fields,
      "COMMUNICATION_BRIDGE_CALENDAR_ATTACHMENT_FIELD_ID",
      COMMUNICATION_BRIDGE_ATTACHMENT_CAPTION,
    ),
  };
}

export function communicationBridgeFieldsCsv(
  ids: CommunicationBridgeFieldIds,
): string {
  return [ids.dateFieldId, ids.attachmentFieldId]
    .map((id) => id?.trim())
    .filter(Boolean)
    .join(",");
}

/** buildCalendarPayload 用（日付列のみ・タイトルなし＝添付画像表示） */
export function toCommunicationBridgeCalendarFieldIds(
  ids: CommunicationBridgeFieldIds,
): ConstructionFieldIds {
  return {
    title: "",
    contractor: "",
    startDate: ids.dateFieldId?.trim() ?? "",
    endDate: "",
    memo: "",
    housingStatus: "",
    shigumi: "",
    panelWork: "",
    electricWork: "",
    appSettingsDay: "",
    tNumber: "",
    manufacturer: "",
    panelCapacity: "",
    batteryCapacity: "",
    inputStatus: "",
    zankoDay: "",
    constructionHandler: "",
  };
}

function recordObject(
  rec: AtPocketRecordRow,
): Record<string, unknown> | null {
  if (!rec.record || typeof rec.record !== "object") return null;
  return rec.record as Record<string, unknown>;
}

/** 日付・添付ファイルが両方あるレコードだけ残す */
export function filterCommunicationBridgeRecords(
  records: AtPocketRecordRow[],
  ids: CommunicationBridgeFieldIds,
): AtPocketRecordRow[] {
  const dateId = ids.dateFieldId?.trim();
  const attachmentId = ids.attachmentFieldId?.trim();
  if (!dateId || !attachmentId) return [];

  return records.filter((rec) => {
    const recObj = recordObject(rec);
    if (!recObj) return false;
    const dateRaw = recObj[dateId];
    if (dateRaw == null || String(dateRaw).trim() === "") return false;
    const files = parseAtPocketFileField(recObj[attachmentId]);
    return files.some(
      (f) =>
        f.contentBase64?.trim() ||
        f.externalUrl?.trim() ||
        f.name.trim(),
    );
  });
}

/** @deprecated resolveCommunicationBridgeFieldIds を使用してください */
export function resolveCommunicationBridgeAttachmentFieldId(
  fields: AtPocketFieldRow[],
): string | null {
  return resolveCommunicationBridgeFieldIds(fields).attachmentFieldId;
}

/** @deprecated toCommunicationBridgeCalendarFieldIds を使用してください */
export function resolveCommunicationBridgeCalendarFieldIds(
  fields: AtPocketFieldRow[],
): ConstructionFieldIds {
  return toCommunicationBridgeCalendarFieldIds(
    resolveCommunicationBridgeFieldIds(fields),
  );
}
