import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import {
  pocketFieldUniqueIdByCaption,
  resolveConfiguredFieldToSchemaUniqueId,
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
