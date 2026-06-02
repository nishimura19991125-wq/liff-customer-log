import { dateValueForPocket } from "@/lib/customer-info-form/date-pocket";
import {
  isContractAmountDerived,
  syncContractAmountFromPayment,
} from "@/lib/customer-info-form/form-change";
import { hasDecimalKwValue } from "@/lib/customer-info-form/decimal-kw";
import { parseCommaIntegerDigits } from "@/lib/customer-info-form/numeric-comma";
import { isValidPostalCodeFormat } from "@/lib/customer-info-form/postal-code";
import { parsePtDigitsOnly } from "@/lib/customer-info-form/pt-transfer";
import { isCustomerInfoFormFieldVisible } from "@/lib/customer-info-form/rules";
import type {
  CustomerInfoFieldType,
  CustomerInfoFormValues,
} from "@/lib/customer-info-form/types";

export type CustomerInfoFormFieldForValidate = {
  key: string;
  label: string;
  type: CustomerInfoFieldType;
};

function checkboxSelections(raw: string): string[] {
  return raw
    .split(/[,、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isBlankText(raw: string): boolean {
  const t = raw.trim();
  return t === "" || t === "-";
}

/** 表示中の項目が未入力か（非表示・自動算出の契約金額は対象外） */
export function isCustomerInfoVisibleFieldValueMissing(
  field: CustomerInfoFormFieldForValidate,
  values: CustomerInfoFormValues,
): boolean {
  const synced = syncContractAmountFromPayment(values);
  if (!isCustomerInfoFormFieldVisible(field.key, synced)) return false;

  if (
    field.key === "contractAmount" &&
    isContractAmountDerived(synced.paymentMethod ?? "")
  ) {
    return false;
  }

  const raw =
    field.key === "contractAmount"
      ? (synced.contractAmount ?? "")
      : (synced[field.key] ?? "");

  switch (field.type) {
    case "checkbox-group":
      return checkboxSelections(raw).length === 0;
    case "comma-integer":
      return !parseCommaIntegerDigits(raw);
    case "pt-integer":
      return !parsePtDigitsOnly(raw);
    case "postal-code":
      return !isValidPostalCodeFormat(raw);
    case "decimal-kw":
      return !hasDecimalKwValue(raw);
    case "date":
      return !dateValueForPocket(raw);
    default:
      return isBlankText(raw);
  }
}

export function findMissingRequiredCustomerInfoFields(
  fields: readonly CustomerInfoFormFieldForValidate[],
  values: CustomerInfoFormValues,
): CustomerInfoFormFieldForValidate[] {
  return fields.filter((f) =>
    isCustomerInfoVisibleFieldValueMissing(f, values),
  );
}

const MAX_LABELS_IN_MESSAGE = 8;

export function formatCustomerInfoRequiredValidationError(
  missing: readonly CustomerInfoFormFieldForValidate[],
): string {
  if (missing.length === 0) return "";
  const labels = missing.map((f) => f.label);
  const shown = labels.slice(0, MAX_LABELS_IN_MESSAGE);
  const rest = labels.length - shown.length;
  const list = rest > 0 ? `${shown.join("、")} ほか${rest}件` : shown.join("、");
  return `未入力の必須項目があります: ${list}`;
}
