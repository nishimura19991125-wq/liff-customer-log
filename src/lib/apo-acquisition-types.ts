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
  | "staffSelect";

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

export type ApoAcquisitionCreateInput = {
  apStaffName: string;
  values: ApoAcquisitionValues;
};

export type ApoAcquisitionCreateResult =
  | { ok: true; recordId: string }
  | { ok: false; status: number; error: string };
