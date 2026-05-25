import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import { readCustomerInfoFieldValue } from "@/lib/customer-info-record";
import { resolveCustomerInfoFormFieldId } from "@/lib/customer-info-form/resolve-fields";

/** CRM で監視する16書類（フォーム key と @pocket 見出し） */
export const CRM_DOCUMENT_FIELD_SPECS = [
  { key: "loanPaper", caption: "ローン用紙" },
  { key: "groupCreditLifeInsurance", caption: "団体信用生命保険" },
  { key: "salesConstructionContract", caption: "商品売買・工事請負契約書" },
  { key: "powerCompanyForm", caption: "電力会社記入用紙" },
  { key: "feedInBankAccountForm", caption: "売電先振込口座指定依頼書" },
  { key: "vicinitySketchMap", caption: "付近見取り図" },
  { key: "powerOfAttorneyStorage", caption: "委任状(創蓄)" },
  { key: "powerOfAttorneyChangeCert", caption: "委任状(変更認定用)" },
  { key: "powerOfAttorneyIdPassword", caption: "委任状(ID・パスワード開示用)" },
  { key: "equipmentCertConsent", caption: "設備認定に関する同意書" },
  { key: "operatingCostReportConsent", caption: "運転費用年報提出に関する同意書" },
  { key: "personalInfoConsent", caption: "個人情報の取扱に関する同意書" },
  { key: "freeUseGenerationConsent", caption: "発電設備の無償使用に関する同意書" },
  { key: "sealRegistrationCertificate", caption: "印鑑登録証明書" },
  { key: "registryBook", caption: "登記簿" },
  { key: "subsidyPreApplicationDocs", caption: "補助金事前申請書類" },
] as const;

const DOCUMENT_ALERT_STATUSES = new Set(
  ["未回収", "未作成", "未確認"].map((s) => s.normalize("NFKC")),
);

export type CrmResolvedDocumentField = {
  key: string;
  caption: string;
  fieldId: string;
};

export type CrmDocumentCheckItem = {
  key: string;
  label: string;
  value: string;
  isMissing: boolean;
};

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

export function resolveCrmDocumentFields(
  appFields: AtPocketFieldRow[],
): CrmResolvedDocumentField[] {
  const resolved: CrmResolvedDocumentField[] = [];
  for (const spec of CRM_DOCUMENT_FIELD_SPECS) {
    const fieldId = resolveCustomerInfoFormFieldId(
      spec.key,
      spec.caption,
      appFields,
    );
    if (fieldId) {
      resolved.push({ key: spec.key, caption: spec.caption, fieldId });
    }
  }
  return resolved;
}

export function isDocumentStatusAlert(raw: string): boolean {
  const v = nfkc(raw);
  if (!v || v === "-") return true;
  return DOCUMENT_ALERT_STATUSES.has(v);
}

export function evaluateCrmDocuments(
  recObj: Record<string, unknown>,
  docFields: readonly CrmResolvedDocumentField[],
): { isDocumentMissing: boolean; documents: CrmDocumentCheckItem[] } {
  const documents: CrmDocumentCheckItem[] = [];
  let isDocumentMissing = false;

  for (const field of docFields) {
    const value = readCustomerInfoFieldValue(recObj, field.fieldId);
    const isMissing = isDocumentStatusAlert(value);
    if (isMissing) isDocumentMissing = true;
    documents.push({
      key: field.key,
      label: field.caption,
      value: value || "—",
      isMissing,
    });
  }

  return { isDocumentMissing, documents };
}

export function resolveCrmConstructionDateFieldId(
  appFields: AtPocketFieldRow[],
): string | null {
  const env = process.env.CUSTOMER_INFO_CONSTRUCTION_DATE_FIELD_ID?.trim();
  if (env) {
    return resolveConfiguredFieldToSchemaUniqueId(env, appFields);
  }
  for (const cap of ["工事日", "施工予定日", "着工日", "工事日程"]) {
    const id = pickFieldUniqueIdByExactCaption(appFields, cap);
    if (id) return id;
  }
  return null;
}

/** 「補助金有無」列の uniqueId（環境変数で上書き可） */
export function resolveCrmSubsidyFieldId(
  appFields: AtPocketFieldRow[],
): string | null {
  const env =
    process.env.CUSTOMER_INFO_SUBSIDY_FIELD_ID?.trim() ??
    process.env.CUSTOMER_INFO_SUBSIDY_USAGE_FIELD_ID?.trim();
  if (env) {
    return resolveConfiguredFieldToSchemaUniqueId(env, appFields);
  }
  const id =
    pickFieldUniqueIdByExactCaption(appFields, "補助金有無") ??
    resolveCustomerInfoFormFieldId("subsidy", "補助金有無", appFields);
  return id;
}

/** @deprecated resolveCrmSubsidyFieldId を使用 */
export const resolveCrmSubsidyUsageFieldId = resolveCrmSubsidyFieldId;

export type CrmSubsidyFieldIds = {
  /** 補助金有無 */
  subsidyPresenceId: string | null;
  prefectureSubsidyId: string | null;
  citySubsidyId: string | null;
  otherSubsidyId: string | null;
};

/** 補助金関連4列の uniqueId を解決 */
export function resolveCrmSubsidyFieldIds(
  appFields: AtPocketFieldRow[],
): CrmSubsidyFieldIds {
  return {
    subsidyPresenceId: resolveCrmSubsidyFieldId(appFields),
    prefectureSubsidyId: resolveCustomerInfoFormFieldId(
      "prefectureSubsidy",
      "都道府県補助金",
      appFields,
    ),
    citySubsidyId: resolveCustomerInfoFormFieldId(
      "citySubsidy",
      "市区町村補助金",
      appFields,
    ),
    otherSubsidyId: resolveCustomerInfoFormFieldId(
      "otherSubsidy",
      "その他補助金",
      appFields,
    ),
  };
}

export type CrmSubsidyInfo = {
  isSubsidyTarget: boolean;
  /** 都道府県・市区町村・その他を / で結合（詳細が空なら補助金有無の値） */
  combinedSubsidyName: string | null;
  /** 補助金有無の生の値 */
  subsidyPresence: string | null;
};

function isCrmSubsidyDetailText(raw: string): boolean {
  const v = nfkc(raw);
  return Boolean(v && v !== "-" && v !== "無");
}

/**
 * 補助金有無＋3詳細列から対象判定と結合表示名を組み立てる。
 */
export function buildCrmSubsidyInfo(
  recObj: Record<string, unknown>,
  ids: CrmSubsidyFieldIds,
): CrmSubsidyInfo {
  const presenceRaw = ids.subsidyPresenceId
    ? readCustomerInfoFieldValue(recObj, ids.subsidyPresenceId)
    : "";
  const subsidyPresence = nfkc(presenceRaw);

  if (!subsidyPresence || subsidyPresence === "-" || subsidyPresence === "無") {
    return {
      isSubsidyTarget: false,
      combinedSubsidyName: null,
      subsidyPresence: subsidyPresence || null,
    };
  }

  const detailParts = [
    ids.prefectureSubsidyId
      ? readCustomerInfoFieldValue(recObj, ids.prefectureSubsidyId)
      : "",
    ids.citySubsidyId
      ? readCustomerInfoFieldValue(recObj, ids.citySubsidyId)
      : "",
    ids.otherSubsidyId
      ? readCustomerInfoFieldValue(recObj, ids.otherSubsidyId)
      : "",
  ]
    .map((raw) => nfkc(raw))
    .filter(isCrmSubsidyDetailText);

  const combinedSubsidyName =
    detailParts.length > 0 ? detailParts.join(" / ") : subsidyPresence;

  return {
    isSubsidyTarget: true,
    combinedSubsidyName,
    subsidyPresence,
  };
}

export function isCrmConstructionDateUnset(
  recObj: Record<string, unknown>,
  constructionDateFieldId: string | null,
): boolean {
  if (!constructionDateFieldId) return false;
  const raw = readCustomerInfoFieldValue(recObj, constructionDateFieldId);
  const v = nfkc(raw);
  if (!v || v === "-") return true;
  const digits = v.replace(/[^\d]/g, "");
  return digits.length < 8;
}

export function resolveCrmSortDateFieldId(
  appFields: AtPocketFieldRow[],
): string | null {
  const env = process.env.CUSTOMER_INFO_UPDATED_DATE_FIELD_ID?.trim();
  if (env) {
    return resolveConfiguredFieldToSchemaUniqueId(env, appFields);
  }
  for (const cap of ["更新日", "最終更新日", "登録日", "作成日", "作成日時"]) {
    const id = pickFieldUniqueIdByExactCaption(appFields, cap);
    if (id) return id;
  }
  return null;
}

export function crmSortKeyFromRecord(
  recObj: Record<string, unknown>,
  recordId: string,
  sortFieldId: string | null,
): number {
  if (sortFieldId) {
    const raw = readCustomerInfoFieldValue(recObj, sortFieldId);
    const digits = raw.replace(/[^\d]/g, "");
    if (digits.length >= 8) {
      const n = Number(digits.slice(0, 14).padEnd(14, "0"));
      if (Number.isFinite(n)) return n;
    }
  }
  const idNum = Number(recordId);
  return Number.isFinite(idNum) ? idNum : 0;
}
