import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import { customerInfoNameFieldId } from "@/lib/customer-info-config";
import {
  fieldCaptionByUniqueId,
  readCustomerInfoFieldValue,
} from "@/lib/customer-info-record";
import {
  CUSTOMER_INFO_FORM_FIELDS,
  CUSTOMER_INFO_FORM_FIELD_MAP,
} from "@/lib/customer-info-form/schema";
import type {
  CustomerInfoFormFieldResolved,
  CustomerInfoFormValues,
} from "@/lib/customer-info-form/types";

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

function pickFieldUniqueIdByExactCaption(
  fields: AtPocketFieldRow[],
  caption: string,
): string | null {
  const target = nfkc(caption).toLowerCase();
  for (const f of fields) {
    const cap = f.caption ? nfkc(String(f.caption)).toLowerCase() : "";
    if (cap && cap === target) {
      const id = f.uniqueId?.trim();
      return id || null;
    }
  }
  return null;
}

/** CUSTOMER_INFO_FIELD_PT 形式の環境変数（キーは apStaff → AP_STAFF） */
function envFieldIdForFormKey(key: string): string | undefined {
  const snake = key
    .replace(/([A-Z])/g, "_$1")
    .replace(/^_/, "")
    .toUpperCase();
  return process.env[`CUSTOMER_INFO_FIELD_${snake}`]?.trim() || undefined;
}

export function resolveCustomerInfoFormFieldId(
  key: string,
  caption: string,
  appFields: AtPocketFieldRow[],
): string | null {
  const fromEnv = envFieldIdForFormKey(key);
  if (fromEnv) {
    return resolveConfiguredFieldToSchemaUniqueId(fromEnv, appFields);
  }
  if (key === "customerName") {
    const nameEnv = customerInfoNameFieldId();
    if (nameEnv) {
      return resolveConfiguredFieldToSchemaUniqueId(nameEnv, appFields);
    }
  }
  return pickFieldUniqueIdByExactCaption(appFields, caption);
}

export function resolveCustomerInfoFormFields(
  appFields: AtPocketFieldRow[],
): {
  resolved: CustomerInfoFormFieldResolved[];
  missingCaptions: string[];
} {
  const resolved: CustomerInfoFormFieldResolved[] = [];
  const missingCaptions: string[] = [];

  for (const def of CUSTOMER_INFO_FORM_FIELDS) {
    const fieldId = resolveCustomerInfoFormFieldId(
      def.key,
      def.caption,
      appFields,
    );
    if (!fieldId) {
      missingCaptions.push(def.caption);
      continue;
    }
    resolved.push({
      ...def,
      fieldId,
      label: fieldCaptionByUniqueId(appFields, fieldId) || def.caption,
      value: "",
    });
  }

  return { resolved, missingCaptions };
}

export function readCustomerInfoFormValuesFromRecord(
  recObj: Record<string, unknown>,
  resolved: CustomerInfoFormFieldResolved[],
): CustomerInfoFormValues {
  const values: CustomerInfoFormValues = {};
  for (const field of resolved) {
    const raw = readCustomerInfoFieldValue(recObj, field.fieldId);
    if (field.type === "checkbox-group") {
      values[field.key] = raw
        .split(/[,、\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(",");
    } else if (field.type === "date") {
      values[field.key] = normalizeDateForInput(raw);
    } else {
      values[field.key] = raw;
    }
  }
  return values;
}

/** type="date" 向け YYYY-MM-DD */
export function normalizeDateForInput(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const jp = /^(\d{4})[/.年](\d{1,2})[/.月](\d{1,2})/.exec(t);
  if (jp) {
    const m = jp[2].padStart(2, "0");
    const d = jp[3].padStart(2, "0");
    return `${jp[1]}-${m}-${d}`;
  }
  return t;
}

export function customerInfoFormFieldsCsv(
  resolved: CustomerInfoFormFieldResolved[],
): string {
  const ids = new Set<string>();
  for (const f of resolved) ids.add(f.fieldId);
  return [...ids].join(",");
}

export function formValuesFromPutBody(
  body: Record<string, unknown>,
  resolved: CustomerInfoFormFieldResolved[],
): CustomerInfoFormValues | null {
  const byKey: CustomerInfoFormValues = {};
  const byFieldId: CustomerInfoFormValues = {};
  let hasKey = false;
  let hasFieldId = false;

  for (const field of resolved) {
    if (Object.prototype.hasOwnProperty.call(body, field.key)) {
      hasKey = true;
      byKey[field.key] = String(body[field.key] ?? "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(body, field.fieldId)) {
      hasFieldId = true;
      byFieldId[field.key] = String(body[field.fieldId] ?? "").trim();
    }
  }

  if (hasKey) return byKey;
  if (hasFieldId) return byFieldId;
  return null;
}

export function getCustomerInfoFormFieldDef(key: string) {
  return CUSTOMER_INFO_FORM_FIELD_MAP.get(key);
}
