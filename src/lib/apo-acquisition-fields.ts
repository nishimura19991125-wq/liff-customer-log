import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import {
  pocketFieldUniqueIdByCaption,
  resolveConfiguredFieldToSchemaUniqueId,
} from "@/lib/calendar-kojo";
import {
  APO_ACQUISITION_FIELD_KEYS,
  type ApoAcquisitionFieldKey,
  type ApoAcquisitionInputKind,
} from "@/lib/apo-acquisition-types";

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

type FieldSpec = {
  key: ApoAcquisitionFieldKey;
  label: string;
  kind: ApoAcquisitionInputKind;
  required: boolean;
  /** 環境変数で uniqueId を上書き（任意） */
  envKey: string;
  /** 見出し（キャプション）候補。完全一致優先→部分一致 */
  captions: string[];
  placeholder?: string;
  /** select の既定選択肢（@pocket 側の選択肢が取れない場合のフォールバック） */
  options?: string[];
  hint?: string;
};

/** 各項目の定義（表示順は APO_ACQUISITION_FIELD_KEYS） */
export const APO_ACQUISITION_FIELD_SPECS: Record<
  ApoAcquisitionFieldKey,
  FieldSpec
> = {
  apStaff: {
    key: "apStaff",
    label: "AP担当者",
    kind: "staffSelect",
    required: true,
    envKey: "SALES_DASHBOARD_APO_SALESPERSON_FIELD_ID",
    captions: ["AP担当者", "AP 担当者", "アポインター", "アポ担当者", "AP担当"],
  },
  clStaff: {
    key: "clStaff",
    label: "CL担当者",
    kind: "staffSelect",
    required: true,
    envKey: "APO_ACQUISITION_CL_STAFF_FIELD_ID",
    captions: ["CL担当者", "CL 担当者", "クローザー"],
  },
  apoAcquiredDate: {
    key: "apoAcquiredDate",
    label: "アポ取得日",
    kind: "date",
    required: true,
    envKey: "APO_ACQUISITION_DATE_FIELD_ID",
    captions: ["アポ取得日", "アポ日", "取得日"],
  },
  giftCoupon: {
    key: "giftCoupon",
    label: "ギフト券",
    kind: "select",
    required: false,
    envKey: "APO_ACQUISITION_GIFT_COUPON_FIELD_ID",
    captions: ["ギフト券", "ギフト", "商品券"],
    options: ["有", "無"],
  },
  apoRank: {
    key: "apoRank",
    label: "アポランク",
    kind: "select",
    required: false,
    envKey: "APO_ACQUISITION_APO_RANK_FIELD_ID",
    captions: ["アポランク", "APランク", "ランク"],
    options: ["A", "B", "C", "D"],
  },
  apoType: {
    key: "apoType",
    label: "アポ種別",
    kind: "select",
    required: true,
    envKey: "APO_ACQUISITION_APO_TYPE_FIELD_ID",
    captions: ["アポ種別", "アポタイプ", "種別", "導入経緯"],
    options: ["ダイレクト", "お客様紹介", "(DC)工務店OBリスト", "ソーラーパートナーズ"],
  },
  contractorPartner: {
    key: "contractorPartner",
    label: "工務店及びお取引先",
    kind: "text",
    required: false,
    envKey: "APO_ACQUISITION_CONTRACTOR_PARTNER_FIELD_ID",
    captions: [
      "工務店及びお取引先",
      "工務店及び取引先",
      "工務店・お取引先",
      "工務店",
      "お取引先",
      "取引先",
    ],
  },
  contractorPerson: {
    key: "contractorPerson",
    label: "工務店担当者",
    kind: "text",
    required: false,
    envKey: "APO_ACQUISITION_CONTRACTOR_PERSON_FIELD_ID",
    captions: ["工務店担当者", "工務店 担当者", "取引先担当者"],
  },
  estimateType: {
    key: "estimateType",
    label: "見積種別",
    kind: "text",
    required: false,
    envKey: "APO_ACQUISITION_ESTIMATE_TYPE_FIELD_ID",
    captions: ["見積種別", "見積り種別", "見積もり種別"],
  },
  scheduledDate: {
    key: "scheduledDate",
    label: "商談・資料送付予定日時",
    kind: "datetime",
    required: true,
    envKey: "MEETING_SCHEDULE_DATE_FIELD_ID",
    captions: ["商談・資料送付予定日時", "商談資料送付予定日時"],
  },
  estimateRequest: {
    key: "estimateRequest",
    label: "見積依頼内容",
    kind: "textarea",
    required: false,
    envKey: "APO_ACQUISITION_ESTIMATE_REQUEST_FIELD_ID",
    captions: ["見積依頼内容", "見積り依頼内容", "見積もり依頼内容", "依頼内容"],
  },
  customerName: {
    key: "customerName",
    label: "お客様名",
    kind: "text",
    required: true,
    envKey: "MEETING_SCHEDULE_CUSTOMER_NAME_FIELD_ID",
    captions: ["お客様名", "顧客氏名", "顧客名", "お客様"],
    placeholder: "例）山田 太郎",
  },
  elevationPlanAttachment: {
    key: "elevationPlanAttachment",
    label: "立平面図",
    kind: "file",
    required: false,
    envKey: "APO_ACQUISITION_ELEVATION_PLAN_FIELD_ID",
    captions: [
      "立平面図の添付場所",
      "立平面図の添付",
      "立平面図添付場所",
      "立平面図",
      "図面添付",
      "図面",
    ],
  },
  postalCode: {
    key: "postalCode",
    label: "郵便番号",
    kind: "text",
    required: false,
    envKey: "APO_ACQUISITION_POSTAL_CODE_FIELD_ID",
    captions: ["郵便番号", "〒", "郵便"],
    placeholder: "例）530-0001",
    hint: "000-0000 形式で入力すると都道府県・市区郡・町村を自動入力します",
  },
  prefecture: {
    key: "prefecture",
    label: "都道府県",
    kind: "text",
    required: false,
    envKey: "APO_ACQUISITION_PREFECTURE_FIELD_ID",
    captions: ["都道府県"],
  },
  city: {
    key: "city",
    label: "市区郡",
    kind: "text",
    required: false,
    envKey: "APO_ACQUISITION_CITY_FIELD_ID",
    captions: ["市区郡", "市区町村"],
  },
  town: {
    key: "town",
    label: "町村",
    kind: "text",
    required: false,
    envKey: "APO_ACQUISITION_TOWN_FIELD_ID",
    captions: ["町村", "町村名"],
  },
  subsidy: {
    key: "subsidy",
    label: "補助金有無",
    kind: "select",
    required: false,
    envKey: "APO_ACQUISITION_SUBSIDY_FIELD_ID",
    captions: ["補助金有無", "補助金", "補助金の有無"],
    options: ["有", "無", "不明"],
  },
  pinpointAddress: {
    key: "pinpointAddress",
    label: "ピンポイント住所",
    kind: "text",
    required: false,
    envKey: "APO_ACQUISITION_PINPOINT_ADDRESS_FIELD_ID",
    captions: ["ピンポイント住所", "住所", "所在地"],
  },
  customerContact: {
    key: "customerContact",
    label: "お客様連絡先",
    kind: "text",
    required: false,
    envKey: "APO_ACQUISITION_CUSTOMER_CONTACT_FIELD_ID",
    captions: ["お客様連絡先", "連絡先", "電話番号", "携帯", "TEL"],
    placeholder: "例）090-0000-0000",
  },
  buildingAge: {
    key: "buildingAge",
    label: "築年数",
    kind: "text",
    required: false,
    envKey: "APO_ACQUISITION_BUILDING_AGE_FIELD_ID",
    captions: ["築年数", "築", "建築年数"],
  },
  builderName: {
    key: "builderName",
    label: "建元名",
    kind: "text",
    required: false,
    envKey: "APO_ACQUISITION_BUILDER_NAME_FIELD_ID",
    captions: ["建元名", "建元", "ハウスメーカー", "施工会社名"],
  },
  roofShape: {
    key: "roofShape",
    label: "屋根形状",
    kind: "select",
    required: false,
    envKey: "APO_ACQUISITION_ROOF_SHAPE_FIELD_ID",
    captions: ["屋根形状", "屋根の形状"],
    options: ["片流れ", "切妻", "寄棟", "陸屋根"],
  },
  roofMaterial: {
    key: "roofMaterial",
    label: "屋根材",
    kind: "select",
    required: false,
    envKey: "APO_ACQUISITION_ROOF_MATERIAL_FIELD_ID",
    captions: ["屋根材", "屋根材質"],
    options: [
      "金属縦平葺",
      "カラーベスト",
      "アスファルトシングル",
      "平板瓦",
      "洋瓦",
      "ルーガ鉄平(XSOL不可)",
      "ルーガ雅(XSOL不可)",
      "和瓦",
      "金属横葺",
      "その他",
    ],
  },
  otherRoofMaterial: {
    key: "otherRoofMaterial",
    label: "その他屋根材",
    kind: "text",
    required: false,
    envKey: "APO_ACQUISITION_OTHER_ROOF_MATERIAL_FIELD_ID",
    captions: ["その他屋根材", "その他の屋根材", "屋根材その他"],
  },
  electricOrGas: {
    key: "electricOrGas",
    label: "オール電化orガス",
    kind: "select",
    required: false,
    envKey: "APO_ACQUISITION_ELECTRIC_OR_GAS_FIELD_ID",
    captions: ["オール電化orガス", "オール電化", "電化ガス", "電気ガス"],
    options: ["オール電化", "ガス"],
  },
  existingEquipment: {
    key: "existingEquipment",
    label: "既設設備",
    kind: "textarea",
    required: false,
    envKey: "APO_ACQUISITION_EXISTING_EQUIPMENT_FIELD_ID",
    captions: ["既設設備", "既存設備", "設備"],
    placeholder: "例）太陽光・エコキュート 等",
  },
  averageElectricBill: {
    key: "averageElectricBill",
    label: "平均電気代",
    kind: "text",
    required: false,
    envKey: "APO_ACQUISITION_AVERAGE_ELECTRIC_BILL_FIELD_ID",
    captions: ["平均電気代", "電気代", "月平均電気代"],
    placeholder: "例）15000",
  },
  familyComposition: {
    key: "familyComposition",
    label: "家族構成",
    kind: "text",
    required: false,
    envKey: "APO_ACQUISITION_FAMILY_COMPOSITION_FIELD_ID",
    captions: ["家族構成", "世帯構成"],
  },
  familyFeatures: {
    key: "familyFeatures",
    label: "ご家族の特徴",
    kind: "textarea",
    required: false,
    envKey: "APO_ACQUISITION_FAMILY_FEATURES_FIELD_ID",
    captions: ["ご家族の特徴", "家族の特徴", "特徴"],
  },
  conversationContent: {
    key: "conversationContent",
    label: "会話した内容",
    kind: "textarea",
    required: false,
    envKey: "APO_ACQUISITION_CONVERSATION_FIELD_ID",
    captions: ["会話した内容", "会話内容", "商談内容", "会話"],
  },
  otherSharedItems: {
    key: "otherSharedItems",
    label: "その他共有事項",
    kind: "textarea",
    required: false,
    envKey: "APO_ACQUISITION_OTHER_SHARED_FIELD_ID",
    captions: ["その他共有事項", "共有事項", "その他共有", "備考", "メモ"],
  },
};

function pickByCaptionsExactThenPartial(
  fields: AtPocketFieldRow[],
  captions: string[],
): string | null {
  for (const caption of captions) {
    const id = pocketFieldUniqueIdByCaption(fields, caption);
    if (id) return id;
  }
  const lowered = captions.map((c) => nfkc(c).toLowerCase());
  for (const f of fields) {
    const cap = f.caption ? nfkc(String(f.caption)).toLowerCase() : "";
    if (!cap) continue;
    if (lowered.some((k) => cap.includes(k))) {
      const id = f.uniqueId?.trim();
      if (id) return id;
    }
  }
  return null;
}

function resolveSpecFieldId(
  spec: FieldSpec,
  fields: AtPocketFieldRow[],
): string | null {
  const env = process.env[spec.envKey]?.trim();
  if (env) {
    const id = resolveConfiguredFieldToSchemaUniqueId(env, fields);
    if (id) return id;
  }
  return pickByCaptionsExactThenPartial(fields, spec.captions);
}

export type ApoAcquisitionResolvedField = {
  spec: FieldSpec;
  uniqueId: string | null;
  /** @pocket 側の選択肢（取れた場合のみ） */
  pocketOptions?: string[];
};

/** @pocket の選択肢定義（choices/options 等）を可能なら取り出す */
function extractPocketOptions(field: AtPocketFieldRow | undefined): string[] {
  if (!field) return [];
  const raw = field as unknown as Record<string, unknown>;
  const candidates =
    raw.choices ?? raw.options ?? raw.selectOptions ?? raw.items ?? null;
  if (!Array.isArray(candidates)) return [];
  const values: string[] = [];
  for (const c of candidates) {
    if (typeof c === "string") {
      const t = c.trim();
      if (t) values.push(t);
    } else if (c && typeof c === "object") {
      const obj = c as Record<string, unknown>;
      const label =
        (typeof obj.label === "string" && obj.label) ||
        (typeof obj.name === "string" && obj.name) ||
        (typeof obj.value === "string" && obj.value) ||
        "";
      const t = String(label).trim();
      if (t) values.push(t);
    }
  }
  return values;
}

const POCKET_FILE_FIELD_TYPES = new Set([
  "File",
  "Attachment",
  "Attachments",
  "Image",
  "Images",
]);

function isPocketFileField(field: AtPocketFieldRow | undefined): boolean {
  if (!field) return false;
  const fieldType = (field.fieldType ?? "").trim();
  if (!fieldType) return true;
  return POCKET_FILE_FIELD_TYPES.has(fieldType);
}

export function resolveApoAcquisitionFields(
  fields: AtPocketFieldRow[],
): Record<ApoAcquisitionFieldKey, ApoAcquisitionResolvedField> {
  const result = {} as Record<
    ApoAcquisitionFieldKey,
    ApoAcquisitionResolvedField
  >;
  for (const key of APO_ACQUISITION_FIELD_KEYS) {
    const spec = APO_ACQUISITION_FIELD_SPECS[key];
    let uniqueId = resolveSpecFieldId(spec, fields);
    const matched = uniqueId
      ? fields.find((f) => f.uniqueId?.trim() === uniqueId)
      : undefined;
    if (spec.kind === "file" && uniqueId && !isPocketFileField(matched)) {
      uniqueId = null;
    }
    result[key] = {
      spec,
      uniqueId,
      pocketOptions: extractPocketOptions(matched),
    };
  }
  return result;
}

export function apoAcquisitionDefaultEstimateStatus(): string {
  return process.env.APO_ACQUISITION_DEFAULT_ESTIMATE_STATUS?.trim() || "新規";
}
