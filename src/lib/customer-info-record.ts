import "server-only";

import type { AtPocketFieldRow, AtPocketRecordRow } from "@/lib/atpocket";
import { atPocketRecordIdFromRow } from "@/lib/atpocket-record-id";
import {
  pickRecordValueByFieldAliases,
  resolveConfiguredFieldToSchemaUniqueId,
} from "@/lib/calendar-kojo";

export function normalizeCustomerInfoSearchText(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

export function coerceCustomerInfoDisplayString(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw).trim();
  }
  if (Array.isArray(raw)) {
    return raw.map(coerceCustomerInfoDisplayString).filter(Boolean).join(" ");
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const k of ["value", "displayValue", "label", "name", "text"]) {
      const v = o[k];
      if (v != null && (typeof v === "string" || typeof v === "number")) {
        return String(v).trim();
      }
    }
  }
  return String(raw).trim();
}

export function customerInfoRecordIdFromRow(
  row: AtPocketRecordRow,
): string | null {
  return atPocketRecordIdFromRow(row);
}

export function fieldCaptionByUniqueId(
  fields: AtPocketFieldRow[],
  uniqueId: string,
): string {
  const id = uniqueId.trim();
  for (const f of fields) {
    if (f.uniqueId?.trim() === id && f.caption?.trim()) {
      return f.caption.trim();
    }
  }
  return id;
}

export function resolveCustomerInfoFieldIds(
  configuredIds: string[],
  fields: AtPocketFieldRow[],
): Array<{ configuredId: string; schemaId: string; caption: string }> {
  const out: Array<{
    configuredId: string;
    schemaId: string;
    caption: string;
  }> = [];
  for (const configuredId of configuredIds) {
    const schemaId = resolveConfiguredFieldToSchemaUniqueId(
      configuredId,
      fields,
    );
    if (!schemaId) continue;
    out.push({
      configuredId,
      schemaId,
      caption: fieldCaptionByUniqueId(fields, schemaId),
    });
  }
  return out;
}

export function readCustomerInfoFieldValue(
  recObj: Record<string, unknown>,
  schemaId: string,
): string {
  return coerceCustomerInfoDisplayString(
    pickRecordValueByFieldAliases(recObj, schemaId),
  );
}

/** 取込キー（T番号）の表示値。正式 uniqueId 以外のキー（field-数字 等）からも拾う */
export function readCustomerInfoImportKeyFromRecord(
  recObj: Record<string, unknown>,
  schemaId: string,
  sourceFieldIds: string[] = [],
): string {
  const direct = readCustomerInfoFieldValue(recObj, schemaId);
  if (direct) return direct;
  for (const sk of sourceFieldIds) {
    const v = readCustomerInfoFieldValue(recObj, sk);
    if (v) return v;
  }
  const legacy = Object.entries(recObj).filter(
    ([k, v]) => /^field-\d+$/i.test(k) && coerceCustomerInfoDisplayString(v),
  );
  if (legacy.length === 1) {
    return coerceCustomerInfoDisplayString(legacy[0][1]);
  }
  return "";
}

/** PUT 用: 文字列・数値程度に正規化 */
export function customerInfoPutValue(raw: unknown): unknown {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return raw;
  return coerceCustomerInfoDisplayString(raw);
}
