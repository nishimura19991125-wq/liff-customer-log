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

/** 14項目の未回収値 */
export const DOCUMENT_STATUS_UNCOLLECTED = "未回収";
/** 付近見取り図のみ */
export const DOCUMENT_STATUS_UNCREATED = "未作成";
/** 登記簿のみ */
export const DOCUMENT_STATUS_UNCONFIRMED = "未確認";

export type CustomerDocumentSpec = {
  /** フォームの key */
  key: string;
  /** @pocket の列見出し。ファイル名の先頭にも使う */
  caption: string;
  /** アップロード成功時に書き込む値 */
  completedValue: string;
  /**
   * 未回収系の値（タスクG のリセット先）。
   *
   * 選択肢の先頭を機械的に取らず、明示的に持つ。選択肢の順序が変わっても
   * リセット先が変わらないようにするため。
   */
  pendingValue: string;
  /**
   * Dropbox への書類アップロードを受け付けるか。
   *
   * ⚠ アップロード対象の定義はここ**1箇所だけ**。画面側の欄の出し分けも、
   *   サーバ側の受け入れ判定も、必ずここを参照すること。
   *   2箇所に分けると、画面に出ていない項目をサーバが受け入れる（またはその逆の）
   *   食い違いが起きる。
   *
   * false の項目でも**ステータスのラジオ（手動変更）は出す**。
   * 廃止したのはアップロード欄だけで、書類不足の判定にも影響しない。
   */
  uploadable: boolean;
};

export const CUSTOMER_DOCUMENT_SPECS: readonly CustomerDocumentSpec[] = [
  {
    key: "loanPaper",
    caption: "ローン用紙",
    completedValue: DOCUMENT_STATUS_COLLECTED,
    pendingValue: DOCUMENT_STATUS_UNCOLLECTED,
    uploadable: false,
  },
  {
    key: "groupCreditLifeInsurance",
    caption: "団体信用生命保険",
    completedValue: DOCUMENT_STATUS_COLLECTED,
    pendingValue: DOCUMENT_STATUS_UNCOLLECTED,
    uploadable: false,
  },
  {
    key: "salesConstructionContract",
    caption: "商品売買・工事請負契約書",
    completedValue: DOCUMENT_STATUS_COLLECTED,
    pendingValue: DOCUMENT_STATUS_UNCOLLECTED,
    uploadable: false,
  },
  {
    key: "powerCompanyForm",
    caption: "電力会社記入用紙",
    completedValue: DOCUMENT_STATUS_COLLECTED,
    pendingValue: DOCUMENT_STATUS_UNCOLLECTED,
    uploadable: false,
  },
  {
    key: "feedInBankAccountForm",
    caption: "売電先振込口座指定依頼書",
    completedValue: DOCUMENT_STATUS_COLLECTED,
    pendingValue: DOCUMENT_STATUS_UNCOLLECTED,
    uploadable: false,
  },
  // ここだけ「作成済み」
  {
    key: "vicinitySketchMap",
    caption: "付近見取り図",
    completedValue: DOCUMENT_STATUS_CREATED,
    pendingValue: DOCUMENT_STATUS_UNCREATED,
    uploadable: true,
  },
  {
    key: "powerOfAttorneyStorage",
    caption: "委任状(創蓄)",
    completedValue: DOCUMENT_STATUS_COLLECTED,
    pendingValue: DOCUMENT_STATUS_UNCOLLECTED,
    uploadable: true,
  },
  {
    key: "powerOfAttorneyChangeCert",
    caption: "委任状(変更認定用)",
    completedValue: DOCUMENT_STATUS_COLLECTED,
    pendingValue: DOCUMENT_STATUS_UNCOLLECTED,
    uploadable: true,
  },
  {
    key: "powerOfAttorneyIdPassword",
    caption: "委任状(ID・パスワード開示用)",
    completedValue: DOCUMENT_STATUS_COLLECTED,
    pendingValue: DOCUMENT_STATUS_UNCOLLECTED,
    uploadable: true,
  },
  {
    key: "equipmentCertConsent",
    caption: "設備認定に関する同意書",
    completedValue: DOCUMENT_STATUS_COLLECTED,
    pendingValue: DOCUMENT_STATUS_UNCOLLECTED,
    uploadable: false,
  },
  {
    key: "operatingCostReportConsent",
    caption: "運転費用年報提出に関する同意書",
    completedValue: DOCUMENT_STATUS_COLLECTED,
    pendingValue: DOCUMENT_STATUS_UNCOLLECTED,
    uploadable: false,
  },
  {
    key: "personalInfoConsent",
    caption: "個人情報の取扱に関する同意書",
    completedValue: DOCUMENT_STATUS_COLLECTED,
    pendingValue: DOCUMENT_STATUS_UNCOLLECTED,
    uploadable: false,
  },
  {
    key: "freeUseGenerationConsent",
    caption: "発電設備の無償使用に関する同意書",
    completedValue: DOCUMENT_STATUS_COLLECTED,
    pendingValue: DOCUMENT_STATUS_UNCOLLECTED,
    uploadable: false,
  },
  {
    key: "sealRegistrationCertificate",
    caption: "印鑑登録証明書",
    completedValue: DOCUMENT_STATUS_COLLECTED,
    pendingValue: DOCUMENT_STATUS_UNCOLLECTED,
    uploadable: true,
  },
  // ここだけ「確認済み」
  {
    key: "registryBook",
    caption: "登記簿",
    completedValue: DOCUMENT_STATUS_CONFIRMED,
    pendingValue: DOCUMENT_STATUS_UNCONFIRMED,
    uploadable: true,
  },
  {
    key: "subsidyPreApplicationDocs",
    caption: "補助金事前申請書類",
    completedValue: DOCUMENT_STATUS_COLLECTED,
    pendingValue: DOCUMENT_STATUS_UNCOLLECTED,
    uploadable: false,
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

/** 書類項目のキー集合（16項目すべて。ステータスのラジオはこの全部に出す） */
export const CUSTOMER_DOCUMENT_KEYS: ReadonlySet<string> = new Set(
  CUSTOMER_DOCUMENT_SPECS.map((s) => s.key),
);

/**
 * Dropbox へのアップロードを受け付ける項目か。
 *
 * 画面のアップロード欄の出し分けと、サーバ側の受け入れ判定の**両方**が
 * この関数を通る。定義を分けると食い違いが起きるため。
 */
export function isUploadableCustomerDocumentKey(key: string): boolean {
  return customerDocumentSpecByKey(key)?.uploadable === true;
}

/** アップロード対象の項目キー（テスト・画面の確認用） */
export const UPLOADABLE_CUSTOMER_DOCUMENT_KEYS: ReadonlySet<string> = new Set(
  CUSTOMER_DOCUMENT_SPECS.filter((s) => s.uploadable).map((s) => s.key),
);
