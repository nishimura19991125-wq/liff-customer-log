/** アポ取得時入力のフィールド定義（表示順） */
export const APO_ACQUISITION_FIELD_KEYS = [
  "apStaff",
  "clStaff",
  "apoAcquiredDate",
  "giftCoupon",
  "apoRank",
  "apoType",
  "contractorPartner",
  "contractorPerson",
  "estimateType",
  "scheduledDate",
  "customerName",
  "elevationPlanAttachment",
  "postalCode",
  "prefecture",
  "city",
  "town",
  "subsidy",
  "pinpointAddress",
  "customerContact",
  "buildingAge",
  "builderName",
  "roofShape",
  "roofMaterial",
  "otherRoofMaterial",
  "electricOrGas",
  "existingEquipment",
  "averageElectricBill",
  "familyComposition",
  "familyFeatures",
  "conversationContent",
  "desiredManufacturer",
  "otherManufacturer",
  "otherSharedItems",
] as const;

export type ApoAcquisitionFieldKey =
  (typeof APO_ACQUISITION_FIELD_KEYS)[number];

export type ApoAcquisitionInputKind =
  | "text"
  | "textarea"
  | "date"
  | "datetime"
  | "select"
  | "staffSelect"
  | "file"
  | "checkboxGroup"
  /**
   * 画面はチェックボックス（複数選択）だが、@pocket 側はテキスト型。
   * 保存時に半角カンマ区切りの文字列へ変換する（希望メーカー）
   */
  | "checkboxGroupText";

/** UI に渡す各フィールドのメタ情報 */
export type ApoAcquisitionFieldMeta = {
  key: ApoAcquisitionFieldKey;
  label: string;
  kind: ApoAcquisitionInputKind;
  required: boolean;
  /** @pocket にこのキャプションの列が見つかったか */
  present: boolean;
  options?: string[];
  placeholder?: string;
  /** 入力欄下の補足 */
  hint?: string;
  /** file 入力の accept 属性 */
  accept?: string;
};

export type ApoAcquisitionFormPayload = {
  configured: boolean;
  writeEnabled: boolean;
  /**
   * 添付（立面図・平面図）が使えるか。Dropbox の設定が揃っていないと false。
   * false のとき画面は添付欄を出さない。レコード登録自体は可能
   */
  attachmentEnabled: boolean;
  configError?: string;
  defaults: {
    apStaffName: string;
    apoAcquiredYmd: string;
    estimateStatus: string;
  };
  fields: ApoAcquisitionFieldMeta[];
};

export type ApoAcquisitionValues = Partial<
  Record<ApoAcquisitionFieldKey, string>
>;

/**
 * 登録の入力。添付は含めない。
 *
 * 添付は Dropbox へ別リクエスト（multipart）で送る。
 * base64 で本文に載せると 5MB×5件で 33MB ほどになり本文の上限に当たるため、
 * ここでは扱わない。監査ログにファイル本体が載らない利点もある
 */
export type ApoAcquisitionCreateInput = {
  apStaffName: string;
  values: ApoAcquisitionValues;
};

/** 監査ログ用。書き込んだ内容と表示ラベル */
export type ApoAcquisitionCreateAudit = {
  appId: string;
  record: Record<string, unknown>;
  labels: Record<string, string>;
};

export type ApoAcquisitionCreateResult =
  | {
      ok: true;
      /** 添付の送信先。/records/{recordId}/attachments に使う */
      recordId: string;
      audit: ApoAcquisitionCreateAudit;
    }
  | { ok: false; status: number; error: string };
