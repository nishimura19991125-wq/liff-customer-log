import "server-only";

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
  "fields",
]);

function isEmptyPocketFieldValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

function mergeFieldsArrayIntoPayload(
  merged: Record<string, unknown>,
  fieldsArr: unknown,
): void {
  if (!Array.isArray(fieldsArr)) return;
  for (const item of fieldsArr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const uid = String(o.uniqueId ?? o.fieldUniqueId ?? o.id ?? "").trim();
    const val = o.value ?? o.displayValue ?? o.text ?? o.label;
    if (uid && !isEmptyPocketFieldValue(val)) {
      merged[uid] = val;
    }
    const fieldIdRaw = o.fieldId;
    const fieldNum =
      typeof fieldIdRaw === "number"
        ? fieldIdRaw
        : typeof fieldIdRaw === "string" && fieldIdRaw.trim()
          ? Number(fieldIdRaw)
          : NaN;
    if (Number.isFinite(fieldNum) && !isEmptyPocketFieldValue(val)) {
      merged[`field-${fieldNum}`] = val;
      merged[`field_${fieldNum}`] = val;
    }
  }
}

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

  mergeFieldsArrayIntoPayload(merged, rowObj.fields);
  if (row.record && typeof row.record === "object") {
    mergeFieldsArrayIntoPayload(
      merged,
      (row.record as Record<string, unknown>).fields,
    );
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
    if (!isEmptyPocketFieldValue(value)) return value;
  }
  for (const [key, value] of Object.entries(payload)) {
    if (/^field[-_]4$/i.test(key) && !isEmptyPocketFieldValue(value)) {
      return value;
    }
  }
  return undefined;
}
