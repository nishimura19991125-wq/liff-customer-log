import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import { customerInfoNameFieldId } from "@/lib/customer-info-config";
import {
  fieldCaptionByUniqueId,
  readCustomerInfoFieldValue,
} from "@/lib/customer-info-record";
import {
  CUSTOMER_INFO_PT_TRANSFER_FIELDS,
  formatPtWithCommas,
  parsePtDigitsOnly,
} from "@/lib/customer-info-form/pt-transfer";
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
    if (def.liffOnly) {
      resolved.push({
        ...def,
        fieldId: "",
        label: def.formLabel ?? def.caption,
        value: "",
      });
      continue;
    }
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
      label:
        (def.formLabel ?? fieldCaptionByUniqueId(appFields, fieldId)) ||
        def.caption,
      value: "",
    });
  }

  return { resolved, missingCaptions };
}

export function resolveCustomerInfoPtTransferFields(
  appFields: AtPocketFieldRow[],
): {
  resolved: CustomerInfoFormFieldResolved[];
  missingCaptions: string[];
} {
  const resolved: CustomerInfoFormFieldResolved[] = [];
  const missingCaptions: string[] = [];

  for (const def of CUSTOMER_INFO_PT_TRANSFER_FIELDS) {
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
      key: def.key,
      caption: def.caption,
      type: "text",
      fieldId,
      label: fieldCaptionByUniqueId(appFields, fieldId) || def.caption,
      value: "",
    });
  }

  return { resolved, missingCaptions };
}

function pocketValuePresent(raw: string): boolean {
  const t = raw.trim();
  return t !== "" && t !== "-";
}

/** 品番②・枚数②からパネルの組み合わせ（LIFF 専用）を推定 */
export function inferPanelComboFromRecord(
  recObj: Record<string, unknown>,
  resolved: CustomerInfoFormFieldResolved[],
): "無" | "有" {
  for (const key of ["panelModel2", "panelCount2"] as const) {
    const field = resolved.find((f) => f.key === key);
    if (!field?.fieldId) continue;
    if (pocketValuePresent(readCustomerInfoFieldValue(recObj, field.fieldId))) {
      return "有";
    }
  }
  return "無";
}

/** 蓄電池容量②から蓄電池複数台設置（LIFF 専用）を推定 */
export function inferBatteryMultiFromRecord(
  recObj: Record<string, unknown>,
  resolved: CustomerInfoFormFieldResolved[],
): "無" | "有" {
  const field = resolved.find((f) => f.key === "batteryCapacity2");
  if (!field?.fieldId) return "無";
  if (pocketValuePresent(readCustomerInfoFieldValue(recObj, field.fieldId))) {
    return "有";
  }
  return "無";
}

/** APPT/CLPT から PT（LIFF 専用）を推定 */
export function inferPtFromRecord(
  recObj: Record<string, unknown>,
  transferResolved: CustomerInfoFormFieldResolved[],
): string {
  const clptField = transferResolved.find((f) => f.key === "clpt");
  const apptField = transferResolved.find((f) => f.key === "appt");
  if (!clptField?.fieldId) return "";

  const clptRaw = readCustomerInfoFieldValue(recObj, clptField.fieldId);
  if (!pocketValuePresent(clptRaw)) return "";

  const clptDigits = parsePtDigitsOnly(clptRaw);
  if (!clptDigits) return "";

  const apptRaw = apptField?.fieldId
    ? readCustomerInfoFieldValue(recObj, apptField.fieldId)
    : "";
  if (!pocketValuePresent(apptRaw) || apptRaw.trim() === "-") {
    return formatPtWithCommas(clptDigits);
  }

  const apptDigits = parsePtDigitsOnly(apptRaw);
  if (!apptDigits) return formatPtWithCommas(clptDigits);

  if (apptDigits === clptDigits) {
    const n = Number(apptDigits);
    if (Number.isFinite(n)) {
      return formatPtWithCommas(String(n * 2));
    }
  }

  return formatPtWithCommas(clptDigits);
}

export function readCustomerInfoFormValuesFromRecord(
  recObj: Record<string, unknown>,
  resolved: CustomerInfoFormFieldResolved[],
  transferResolved: CustomerInfoFormFieldResolved[] = [],
): CustomerInfoFormValues {
  const values: CustomerInfoFormValues = {};
  for (const field of resolved) {
    if (field.liffOnly) continue;
    const raw = readCustomerInfoFieldValue(recObj, field.fieldId);
    if (field.type === "checkbox-group") {
      values[field.key] = raw
        .split(/[,、\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(",");
    } else if (field.type === "date") {
      values[field.key] = normalizeDateForInput(raw);
    } else if (field.type === "pt-integer") {
      values[field.key] = formatPtWithCommas(parsePtDigitsOnly(raw));
    } else {
      values[field.key] = raw;
    }
  }
  const panelCombo = resolved.find((f) => f.key === "panelCombo");
  if (panelCombo?.liffOnly) {
    values.panelCombo = inferPanelComboFromRecord(recObj, resolved);
  }
  const batteryMulti = resolved.find((f) => f.key === "batteryMulti");
  if (batteryMulti?.liffOnly) {
    values.batteryMulti = inferBatteryMultiFromRecord(recObj, resolved);
  }
  const ptField = resolved.find((f) => f.key === "pt");
  if (ptField?.liffOnly) {
    values.pt = inferPtFromRecord(recObj, transferResolved);
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
  for (const f of resolved) {
    if (f.liffOnly || !f.fieldId) continue;
    ids.add(f.fieldId);
  }
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
    if (
      field.fieldId &&
      Object.prototype.hasOwnProperty.call(body, field.fieldId)
    ) {
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
