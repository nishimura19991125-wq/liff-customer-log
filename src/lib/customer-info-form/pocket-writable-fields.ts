import type { AtPocketFieldRow } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import type { CustomerInfoFormFieldResolved } from "@/lib/customer-info-form/types";

/** @pocket: レコード登録/更新不可（developers.at-pocket.com フィールドタイプ一覧） */
const POCKET_NON_UPDATABLE_FIELD_TYPES = new Set([
  "Calc",
  "Label",
  "RelationRecords",
  "QRCode",
  "RecordId",
  "UniqueId",
  "Delete",
  "CreatedAt",
  "CreatorCode",
  "CreatorName",
  "UpdatedAt",
  "UpdaterCode",
  "UpdaterName",
  "AccessUrl",
  "AccessEditUrl",
]);

export function isWritableAtPocketField(field: AtPocketFieldRow): boolean {
  const ft = (field.fieldType ?? "").trim();
  if (!ft) return true;
  return !POCKET_NON_UPDATABLE_FIELD_TYPES.has(ft);
}

function writableSchemaUniqueIds(appFields: AtPocketFieldRow[]): Set<string> {
  const ids = new Set<string>();
  for (const f of appFields) {
    const uid = f.uniqueId?.trim();
    if (!uid || !isWritableAtPocketField(f)) continue;
    ids.add(uid);
  }
  return ids;
}

function canonicalWritableFieldId(
  key: string,
  allowed: Set<string>,
  appFields: AtPocketFieldRow[],
): string | null {
  const t = key.trim();
  if (!t) return null;
  if (allowed.has(t)) return t;
  const resolved = resolveConfiguredFieldToSchemaUniqueId(t, appFields);
  if (resolved && allowed.has(resolved)) return resolved;
  return null;
}

export type CustomerInfoPutPayloadDrop = {
  fieldId: string;
  formKey?: string;
  label?: string;
  reason: string;
};

/** PUT 用 payload をアプリ定義の更新可能列だけに絞る（field-39 無効エラー対策） */
export function filterCustomerInfoPutPayload(
  payload: Record<string, unknown>,
  appFields: AtPocketFieldRow[],
  resolved: readonly CustomerInfoFormFieldResolved[] = [],
): {
  payload: Record<string, unknown>;
  dropped: CustomerInfoPutPayloadDrop[];
} {
  const allowed = writableSchemaUniqueIds(appFields);
  const idToMeta = new Map<string, { formKey?: string; label?: string }>();
  for (const f of resolved) {
    const id = f.fieldId?.trim();
    if (!id) continue;
    idToMeta.set(id, { formKey: f.key, label: f.label });
  }

  const filtered: Record<string, unknown> = {};
  const dropped: CustomerInfoPutPayloadDrop[] = [];

  for (const [rawKey, value] of Object.entries(payload)) {
    const canonical = canonicalWritableFieldId(rawKey, allowed, appFields);
    const meta = idToMeta.get(rawKey) ?? idToMeta.get(canonical ?? "");
    if (canonical) {
      filtered[canonical] = value;
      continue;
    }
    const fieldDef = appFields.find((f) => f.uniqueId?.trim() === rawKey.trim());
    let reason = "アプリ定義にない、または更新不可の列です";
    if (fieldDef && !isWritableAtPocketField(fieldDef)) {
      reason = `更新不可の列タイプです（${fieldDef.fieldType ?? "unknown"}）`;
    }
    dropped.push({
      fieldId: rawKey,
      formKey: meta?.formKey,
      label: meta?.label,
      reason,
    });
  }

  return { payload: filtered, dropped };
}

export function formatCustomerInfoPutPayloadDropWarning(
  dropped: readonly CustomerInfoPutPayloadDrop[],
): string {
  if (dropped.length === 0) return "";
  const parts = dropped.slice(0, 5).map((d) => {
    const name = d.label ?? d.formKey ?? d.fieldId;
    return `${name}(${d.fieldId}): ${d.reason}`;
  });
  const rest = dropped.length - parts.length;
  const tail = rest > 0 ? ` ほか${rest}件` : "";
  return `PUT から除外した列: ${parts.join("、")}${tail}`;
}
