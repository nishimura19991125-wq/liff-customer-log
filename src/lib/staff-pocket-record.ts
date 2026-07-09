import type { AtPocketRecordRow } from "@/lib/atpocket";
import { pickRecordValueByFieldAliases } from "@/lib/calendar-kojo";

const STAFF_ROW_META_KEYS = new Set([
  "recordId",
  "id",
  "uniqueId",
  "record",
  "accessEditUrl",
  "accessUrl",
  "updatedAt",
  "createdAt",
  "status",
  "creator",
  "creatorCode",
  "updater",
  "updaterCode",
  "appsId",
  "isDeleted",
]);

/** calendar_atpocket.js と同様: `rec.record ?? rec` をマージしてフィールド値を拾う */
export function staffPocketRecordPayload(
  row: AtPocketRecordRow,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const rowObj = row as Record<string, unknown>;

  for (const [key, value] of Object.entries(rowObj)) {
    if (STAFF_ROW_META_KEYS.has(key)) continue;
    if (value !== undefined && value !== null) merged[key] = value;
  }

  if (row.record && typeof row.record === "object") {
    Object.assign(merged, row.record as Record<string, unknown>);
  }

  return merged;
}

export function pickStaffPocketFieldValue(
  row: AtPocketRecordRow,
  fieldIds: string[],
): unknown {
  const payload = staffPocketRecordPayload(row);
  for (const fieldId of fieldIds) {
    const value = pickRecordValueByFieldAliases(payload, fieldId);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  for (const [key, value] of Object.entries(payload)) {
    if (/^field[-_]4$/i.test(key) && value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return undefined;
}
