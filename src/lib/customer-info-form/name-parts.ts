import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";

const POCKET_NAME_SEPARATOR = "　";

/** 全角・半角スペースで分割。なければ一般的な長さで苗字/名前に分ける */
export function splitJapaneseFullName(full: string): {
  family: string;
  given: string;
} {
  const t = full.normalize("NFKC").trim();
  if (!t) return { family: "", given: "" };

  const spaceParts = t.split(/[\s　]+/).filter(Boolean);
  if (spaceParts.length >= 2) {
    return {
      family: spaceParts[0]!,
      given: spaceParts.slice(1).join(" "),
    };
  }

  if (t.length <= 2) {
    return { family: t, given: "" };
  }
  if (t.length === 3) {
    return { family: t.slice(0, 1), given: t.slice(1) };
  }
  return { family: t.slice(0, 2), given: t.slice(2) };
}

export function joinJapaneseFullName(family: string, given: string): string {
  const f = family.normalize("NFKC").trim();
  const g = given.normalize("NFKC").trim();
  if (f && g) return `${f}${POCKET_NAME_SEPARATOR}${g}`;
  return f || g;
}

/** @pocket の単一列 ↔ フォームの苗字・名前 */
export function expandNamePartsInValues(
  values: CustomerInfoFormValues,
): CustomerInfoFormValues {
  const next = { ...values };
  const name = splitJapaneseFullName(values.customerName ?? "");
  next.customerFamilyName = name.family;
  next.customerGivenName = name.given;
  const furi = splitJapaneseFullName(values.furigana ?? "");
  next.furiganaFamily = furi.family;
  next.furiganaGiven = furi.given;
  return next;
}

export function syncCombinedNameFields(
  values: CustomerInfoFormValues,
): CustomerInfoFormValues {
  return {
    ...values,
    customerName: joinJapaneseFullName(
      values.customerFamilyName ?? "",
      values.customerGivenName ?? "",
    ),
    furigana: joinJapaneseFullName(
      values.furiganaFamily ?? "",
      values.furiganaGiven ?? "",
    ),
  };
}
