import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import {
  pickRecordValueByFieldAliases,
  resolveConfiguredFieldToSchemaUniqueId,
} from "@/lib/calendar-kojo";
import { customerInfoNameFieldId } from "@/lib/customer-info-config";
import {
  fieldCaptionByUniqueId,
  readCustomerInfoFieldValue,
} from "@/lib/customer-info-record";
import { checkboxGroupValueFromPocket } from "@/lib/customer-info-form/checkbox-pocket";
import {
  formatCommaInteger,
  parseCommaIntegerDigits,
} from "@/lib/customer-info-form/numeric-comma";
import {
  CUSTOMER_INFO_PT_TRANSFER_FIELDS,
  formatPtWithCommas,
  parsePtDigitsOnly,
} from "@/lib/customer-info-form/pt-transfer";
import { formatPostalCodeInput } from "@/lib/customer-info-form/postal-code";
import { isWritableAtPocketField } from "@/lib/customer-info-form/pocket-writable-fields";
import { inferPanelComboFromPanelModel2 } from "@/lib/customer-info-form/panel-combo";
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
  usedIds?: ReadonlySet<string>,
): string | null {
  const target = nfkc(caption).toLowerCase();
  for (const f of fields) {
    const cap = f.caption ? nfkc(String(f.caption)).toLowerCase() : "";
    if (cap && cap === target) {
      const id = f.uniqueId?.trim();
      if (!id) continue;
      if (usedIds?.has(id)) continue;
      return id;
    }
  }
  return null;
}

type CaptionResolveRule = {
  captions: string[];
  /** 見出しに含まれていたら除外（例: 都道府県補助金・都道府県+市区町村） */
  rejectIfCaptionIncludes?: string[];
};

/** 住所・補助金など見出しが似た列の取り違え防止 */
const FORM_KEY_CAPTION_RULES: Partial<Record<string, CaptionResolveRule>> = {
  postalCode: {
    captions: ["郵便番号", "〒"],
    rejectIfCaptionIncludes: ["都道府県", "補助", "市区", "町村"],
  },
  prefecture: {
    captions: ["都道府県"],
    rejectIfCaptionIncludes: [
      "補助",
      "市区",
      "町村",
      "郵便",
      "+",
      "と",
      "事前",
    ],
  },
  city: {
    captions: ["市区郡", "市区町村"],
    rejectIfCaptionIncludes: ["補助", "郵便", "番地"],
  },
  address: {
    captions: ["町村+番地", "町村＋番地", "町村・番地", "番地"],
    rejectIfCaptionIncludes: ["補助", "郵便"],
  },
};

function captionMatchesRule(caption: string, rule: CaptionResolveRule): boolean {
  const cap = nfkc(caption).toLowerCase();
  if (!cap) return false;
  for (const reject of rule.rejectIfCaptionIncludes ?? []) {
    const r = nfkc(reject).toLowerCase();
    if (r && cap.includes(r)) return false;
  }
  const targets = rule.captions.map((c) => nfkc(c).toLowerCase());
  return targets.some((t) => t && cap === t);
}

function pickCustomerInfoFieldUniqueId(
  fields: AtPocketFieldRow[],
  key: string,
  caption: string,
  usedIds: ReadonlySet<string>,
): string | null {
  const rule = FORM_KEY_CAPTION_RULES[key];
  if (rule) {
    for (const f of fields) {
      const cap = f.caption ? String(f.caption) : "";
      if (!captionMatchesRule(cap, rule)) continue;
      const id = f.uniqueId?.trim();
      if (id && !usedIds.has(id)) return id;
    }
    return null;
  }
  return pickFieldUniqueIdByExactCaption(fields, caption, usedIds);
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
  usedIds: ReadonlySet<string> = new Set(),
): string | null {
  const fromEnv = envFieldIdForFormKey(key);
  if (fromEnv) {
    const id = resolveConfiguredFieldToSchemaUniqueId(fromEnv, appFields);
    if (id && usedIds.has(id)) return null;
    return id;
  }
  if (key === "customerName") {
    const nameEnv = customerInfoNameFieldId();
    if (nameEnv) {
      const id = resolveConfiguredFieldToSchemaUniqueId(nameEnv, appFields);
      if (id && usedIds.has(id)) return null;
      return id;
    }
  }
  return pickCustomerInfoFieldUniqueId(appFields, key, caption, usedIds);
}

export function resolveCustomerInfoFormFields(
  appFields: AtPocketFieldRow[],
): {
  resolved: CustomerInfoFormFieldResolved[];
  missingCaptions: string[];
} {
  const resolved: CustomerInfoFormFieldResolved[] = [];
  const missingCaptions: string[] = [];
  const usedFieldIds = new Set<string>();

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
      usedFieldIds,
    );
    if (!fieldId) {
      missingCaptions.push(def.caption);
      continue;
    }
    const fieldRow = appFields.find((f) => f.uniqueId?.trim() === fieldId);
    if (fieldRow && !isWritableAtPocketField(fieldRow)) {
      missingCaptions.push(def.caption);
      continue;
    }
    usedFieldIds.add(fieldId);
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
    const fieldRow = appFields.find((f) => f.uniqueId?.trim() === fieldId);
    if (fieldRow && !isWritableAtPocketField(fieldRow)) {
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

/** パネル品番②に「-」以外があれば「有」、なければ「無」（LIFF 専用） */
export function inferPanelComboFromRecord(
  recObj: Record<string, unknown>,
  resolved: CustomerInfoFormFieldResolved[],
): "無" | "有" {
  const field = resolved.find((f) => f.key === "panelModel2");
  if (!field?.fieldId) return "無";
  const raw = readCustomerInfoFieldValue(recObj, field.fieldId);
  return inferPanelComboFromPanelModel2(raw);
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
  const apptTrim = apptRaw.trim();
  if (
    !pocketValuePresent(apptRaw) ||
    apptTrim === "-" ||
    apptTrim === "0"
  ) {
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
      values[field.key] = checkboxGroupValueFromPocket(
        pickRecordValueByFieldAliases(recObj, field.fieldId),
      );
    } else if (field.type === "date") {
      values[field.key] = normalizeDateForInput(raw);
    } else if (field.type === "pt-integer") {
      values[field.key] = formatPtWithCommas(parsePtDigitsOnly(raw));
    } else if (field.type === "comma-integer") {
      values[field.key] = formatCommaInteger(parseCommaIntegerDigits(raw));
    } else if (field.type === "postal-code") {
      const digits = raw.replace(/[^\d]/g, "");
      values[field.key] = digits.length > 0 ? formatPostalCodeInput(digits) : "";
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

  // 列の取り違え・旧データで都道府県列に郵便番号だけ入っているときの表示補正
  const pref = (values.prefecture ?? "").replace(/\s/g, "");
  if (/^\d{3}-?\d{4}$/.test(pref) && !(values.postalCode ?? "").trim()) {
    values.postalCode = formatPostalCodeInput(pref);
    values.prefecture = "";
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
