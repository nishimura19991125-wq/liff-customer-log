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
  "estimateRequest",
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
  | "checkboxGroup";

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

export type ApoAcquisitionFileAttachment = {
  name: string;
  mimeType: string;
  contentBase64: string;
};

export type ApoAcquisitionCreateInput = {
  apStaffName: string;
  values: ApoAcquisitionValues;
  files?: Partial<Record<ApoAcquisitionFieldKey, ApoAcquisitionFileAttachment[]>>;
};

/** 監査ログ用。書き込んだ内容と表示ラベル */
export type ApoAcquisitionCreateAudit = {
  appId: string;
  record: Record<string, unknown>;
  labels: Record<string, string>;
};

export type ApoAcquisitionCreateResult =
  | { ok: true; recordId: string; audit: ApoAcquisitionCreateAudit }
  | { ok: false; status: number; error: string };
