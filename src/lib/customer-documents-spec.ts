/**
 * お客様情報の書類16項目の仕様（キー・見出し・完了値）。
 *
 * サーバ／クライアント双方から参照するため server-only を付けない純粋モジュール。
 * customer-crm-documents.ts もここから読む（一覧を二重に持たない）。
 *
 * ⚠ 完了を表す値は**項目ごとに違う**。一律で「回収済み」を書くと
 *   @pocket のラジオ選択肢に無い値になり、画面表示と集計が壊れる。
 * ⚠ 「回収済」（末尾「み」なし）はどこにも定義されていない。必ず「回収済み」。
 */

/** 14項目の完了値 */
export const DOCUMENT_STATUS_COLLECTED = "回収済み";
/** 付近見取り図のみ */
export const DOCUMENT_STATUS_CREATED = "作成済み";
/** 登記簿のみ */
export const DOCUMENT_STATUS_CONFIRMED = "確認済み";

export type CustomerDocumentSpec = {
  /** フォームの key */
  key: string;
  /** @pocket の列見出し。ファイル名の先頭にも使う */
  caption: string;
  /** アップロード成功時に書き込む値 */
  completedValue: string;
};

export const CUSTOMER_DOCUMENT_SPECS: readonly CustomerDocumentSpec[] = [
  { key: "loanPaper", caption: "ローン用紙", completedValue: DOCUMENT_STATUS_COLLECTED },
  {
    key: "groupCreditLifeInsurance",
    caption: "団体信用生命保険",
    completedValue: DOCUMENT_STATUS_COLLECTED,
  },
  {
    key: "salesConstructionContract",
    caption: "商品売買・工事請負契約書",
    completedValue: DOCUMENT_STATUS_COLLECTED,
  },
  {
    key: "powerCompanyForm",
    caption: "電力会社記入用紙",
    completedValue: DOCUMENT_STATUS_COLLECTED,
  },
  {
    key: "feedInBankAccountForm",
    caption: "売電先振込口座指定依頼書",
    completedValue: DOCUMENT_STATUS_COLLECTED,
  },
  // ここだけ「作成済み」
  {
    key: "vicinitySketchMap",
    caption: "付近見取り図",
    completedValue: DOCUMENT_STATUS_CREATED,
  },
  {
    key: "powerOfAttorneyStorage",
    caption: "委任状(創蓄)",
    completedValue: DOCUMENT_STATUS_COLLECTED,
  },
  {
    key: "powerOfAttorneyChangeCert",
    caption: "委任状(変更認定用)",
    completedValue: DOCUMENT_STATUS_COLLECTED,
  },
  {
    key: "powerOfAttorneyIdPassword",
    caption: "委任状(ID・パスワード開示用)",
    completedValue: DOCUMENT_STATUS_COLLECTED,
  },
  {
    key: "equipmentCertConsent",
    caption: "設備認定に関する同意書",
    completedValue: DOCUMENT_STATUS_COLLECTED,
  },
  {
    key: "operatingCostReportConsent",
    caption: "運転費用年報提出に関する同意書",
    completedValue: DOCUMENT_STATUS_COLLECTED,
  },
  {
    key: "personalInfoConsent",
    caption: "個人情報の取扱に関する同意書",
    completedValue: DOCUMENT_STATUS_COLLECTED,
  },
  {
    key: "freeUseGenerationConsent",
    caption: "発電設備の無償使用に関する同意書",
    completedValue: DOCUMENT_STATUS_COLLECTED,
  },
  {
    key: "sealRegistrationCertificate",
    caption: "印鑑登録証明書",
    completedValue: DOCUMENT_STATUS_COLLECTED,
  },
  // ここだけ「確認済み」
  {
    key: "registryBook",
    caption: "登記簿",
    completedValue: DOCUMENT_STATUS_CONFIRMED,
  },
  {
    key: "subsidyPreApplicationDocs",
    caption: "補助金事前申請書類",
    completedValue: DOCUMENT_STATUS_COLLECTED,
  },
] as const;

const SPEC_BY_KEY = new Map(
  CUSTOMER_DOCUMENT_SPECS.map((spec) => [spec.key, spec] as const),
);

/**
 * 書類項目のキーか。
 * クライアントから来たキーで任意の列を更新されないよう、サーバ側で必ず通すこと。
 */
export function isCustomerDocumentKey(key: string): boolean {
  return SPEC_BY_KEY.has(key.trim());
}

export function customerDocumentSpecByKey(
  key: string,
): CustomerDocumentSpec | null {
  return SPEC_BY_KEY.get(key.trim()) ?? null;
}

/** 書類項目のキー集合（画面のアップロード欄の出し分けに使う） */
export const CUSTOMER_DOCUMENT_KEYS: ReadonlySet<string> = new Set(
  CUSTOMER_DOCUMENT_SPECS.map((s) => s.key),
);
