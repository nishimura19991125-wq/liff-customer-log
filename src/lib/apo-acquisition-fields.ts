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
import { isWritableAtPocketField } from "@/lib/customer-info-form/pocket-writable-fields";
import { apoImportKeyFieldIdsExcludedOnCreate } from "@/lib/meeting-schedule-fields";
import { APO_DESIRED_MANUFACTURER_OPTIONS } from "@/lib/apo-desired-manufacturer";

/**
 * アポ取得情報連携の入力項目の定義。
 *
 * ⚠ **選択肢（options）はハードコードであり、@pocket の実物と手動で
 *    同期する必要がある。**
 *
 * 以前は @pocket の列定義から選択肢を読む実装（extractPocketOptions）が
 * あったが、一度も機能していなかった。atpocket.ts の
 * normalizeAtPocketFieldRow が応答から uniqueId / fieldId / caption /
 * fieldType / relationId / primaryKey の6つだけを残して組み立て直すため、
 * 選択肢の情報はここへ届く前に捨てられている。
 * 自動取得したい場合は atpocket.ts の正規化から直すこと
 * （共有処理のため全アプリ・全画面に影響する）。
 *
 * ズレていると、その選択肢を選んだときだけ @pocket が 400 を返す
 * （例:「オール電化 or ガス 「ガス」 は登録されていません」）。
 * 選ばれるまで表面化しないので、発見が遅れる。
 *
 * ⚠ **実物と突き合わせ済みなのは オール電化orガス だけである。**
 *    ギフト券 / アポ種別 / 見積種別 / 補助金有無 / 屋根形状 / 屋根材 /
 *    既設設備 は未確認で、食い違っている可能性がある。
 *
 * お客様情報側（customer-info-form/options.ts）も同じ方針。
 */

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
  /**
   * select / checkbox の選択肢。**これが唯一の情報源**で、
   * @pocket の実物とは手動で合わせる（ファイル冒頭の注意書きを参照）
   */
  options?: string[];
  /**
   * @pocket 側の選択肢を使わず、必ず options を使う指定。
   *
   * ⚠ 選択肢の自動取得をやめたため、**現在この指定は効果を持たない**
   *    （options は常に使われる）。自動取得を復活させるときに、
   *    運用外の選択肢を画面へ出さないための指定として意味を取り戻す。
   *    どの項目を固定したいかの記録として残している
   */
  fixedOptions?: boolean;
  /**
   * 見出しで引けない列の逃げ道。@pocket のフィールド識別名（field-61 など）。
   * 見出しが分からない項目にだけ使う（推測の見出し候補を書かないため）
   */
  fallbackFieldId?: string;
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
    required: false,
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
    required: true,
    envKey: "APO_ACQUISITION_GIFT_COUPON_FIELD_ID",
    captions: ["ギフト券", "ギフト", "商品券"],
    options: ["有", "無"],
  },
  apoRank: {
    key: "apoRank",
    label: "アポランク",
    kind: "select",
    required: true,
    envKey: "APO_ACQUISITION_APO_RANK_FIELD_ID",
    captions: ["アポランク", "APランク", "ランク"],
    // 画面で選べるのは A / B だけ。@pocket に C / D が残っていても出さない
    options: ["A", "B"],
    fixedOptions: true,
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
    kind: "select",
    required: true,
    envKey: "APO_ACQUISITION_ESTIMATE_TYPE_FIELD_ID",
    captions: ["見積種別", "見積り種別", "見積もり種別"],
    options: [
      "太陽光パネル＋蓄電池",
      "蓄電池単体",
      "太陽光単体",
      "その他",
    ],
  },
  scheduledDate: {
    key: "scheduledDate",
    label: "商談・資料送付予定日時",
    kind: "datetime",
    required: false,
    envKey: "MEETING_SCHEDULE_DATE_FIELD_ID",
    captions: ["商談・資料送付予定日時", "商談資料送付予定日時"],
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
    label: "立面図・平面図",
    kind: "file",
    required: false,
    envKey: "APO_ACQUISITION_ELEVATION_FLOOR_PLAN_FIELD_ID",
    captions: [
      "立面図・平面図",
      "【立面図・平面図】",
      "立面図・平面図の添付",
      "立面図・平面図添付",
      "立平面図",
      "立平面図の添付",
      "立面図",
      "平面図",
    ],
    hint: "立面図・平面図を画像またはPDFで添付（1ファイル5MBまで・最大5件）",
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
    /**
     * 実際の列名は「オール電化 or ガス」（or の前後に半角スペース）。
     * 以前はこれが無く、部分一致で「オール電化」に引っかかって
     * 解決していただけだった。完全一致の候補を先頭に置く
     */
    captions: [
      "オール電化 or ガス",
      "オール電化orガス",
      "オール電化",
      "電化ガス",
      "電気ガス",
    ],
    // @pocket の実物と突き合わせ済み。「ガス」ではなく「ガス住宅」
    options: ["オール電化", "ガス住宅"],
  },
  existingEquipment: {
    key: "existingEquipment",
    label: "既設設備",
    kind: "checkboxGroup",
    required: false,
    envKey: "APO_ACQUISITION_EXISTING_EQUIPMENT_FIELD_ID",
    captions: ["既設設備", "既存設備"],
    options: ["ガス給湯器", "エコキュート", "IH", "エネファーム", "エコウィル"],
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
  desiredManufacturer: {
    key: "desiredManufacturer",
    label: "希望メーカー",
    // 画面は複数選択だが @pocket 側はテキスト型。保存時にカンマ区切りへ変換する
    kind: "checkboxGroupText",
    required: false,
    envKey: "APO_ACQUISITION_DESIRED_MANUFACTURER_FIELD_ID",
    // 見出しが分からないため識別名で引く
    captions: [],
    fallbackFieldId: "field-61",
    options: [...APO_DESIRED_MANUFACTURER_OPTIONS],
    // テキスト型なので @pocket から選択肢は取れない。必ずこの4つを使う
    fixedOptions: true,
  },
  otherManufacturer: {
    key: "otherManufacturer",
    label: "その他メーカー",
    kind: "text",
    // 「その他」が選ばれたときだけ必須。判定はサーバ側で行う
    required: false,
    envKey: "APO_ACQUISITION_OTHER_MANUFACTURER_FIELD_ID",
    captions: [],
    fallbackFieldId: "field-60",
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

function pickByCaptionsExact(
  fields: AtPocketFieldRow[],
  captions: string[],
): string | null {
  for (const caption of captions) {
    const id = pocketFieldUniqueIdByCaption(fields, caption);
    if (id) return id;
  }
  return null;
}

function pickByCaptionsPartial(
  fields: AtPocketFieldRow[],
  captions: string[],
): string | null {
  const lowered = captions
    .map((c) => nfkc(c).toLowerCase())
    .filter((c) => c.length >= 2);
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

function captionLooksRelated(
  field: AtPocketFieldRow,
  captions: string[],
): boolean {
  const cap = field.caption ? nfkc(String(field.caption)).toLowerCase() : "";
  if (!cap) return false;
  return captions.some((c) => {
    const k = nfkc(c).toLowerCase();
    return cap === k || cap.includes(k) || k.includes(cap);
  });
}

function resolveWritableFieldId(
  fields: AtPocketFieldRow[],
  uniqueId: string | null,
): string | null {
  if (!uniqueId) return null;
  const matched = fields.find((f) => f.uniqueId?.trim() === uniqueId);
  if (matched && !isWritableAtPocketField(matched)) return null;
  return uniqueId;
}

function resolveSpecFieldIdRaw(
  spec: FieldSpec,
  fields: AtPocketFieldRow[],
): string | null {
  const env = process.env[spec.envKey]?.trim();

  let uniqueId = pickByCaptionsExact(fields, spec.captions);

  if (!uniqueId && env) {
    const fromEnv = resolveConfiguredFieldToSchemaUniqueId(env, fields);
    const matched = fromEnv
      ? fields.find((f) => f.uniqueId?.trim() === fromEnv)
      : undefined;
    if (matched && captionLooksRelated(matched, spec.captions)) {
      uniqueId = fromEnv;
    }
  }

  if (!uniqueId) {
    uniqueId = pickByCaptionsPartial(fields, spec.captions);
  }

  /**
   * 見出しで引けない列（希望メーカー・その他メーカー）の逃げ道。
   * @pocket のフィールド識別名で直接引く。見出しが分からないので、
   * 推測の見出し候補を書く代わりにこちらを使う
   */
  if (!uniqueId && spec.fallbackFieldId) {
    uniqueId = resolveConfiguredFieldToSchemaUniqueId(
      spec.fallbackFieldId,
      fields,
    );
  }

  return uniqueId;
}

function resolveSpecFieldId(
  spec: FieldSpec,
  fields: AtPocketFieldRow[],
): { uniqueId: string | null; writable: boolean } {
  const rawId = resolveSpecFieldIdRaw(spec, fields);
  if (!rawId) return { uniqueId: null, writable: false };
  if (apoImportKeyFieldIdsExcludedOnCreate(fields).has(rawId)) {
    return { uniqueId: null, writable: false };
  }
  const matched = fields.find((f) => f.uniqueId?.trim() === rawId);
  const writable = matched ? isWritableAtPocketField(matched) : false;
  return {
    uniqueId: rawId,
    writable: writable ? resolveWritableFieldId(fields, rawId) !== null : false,
  };
}

export type ApoAcquisitionResolvedField = {
  spec: FieldSpec;
  uniqueId: string | null;
  /** 標準 POST/PUT で書き込み可能か（連携項目は false） */
  writable: boolean;
};

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
    const { uniqueId: resolvedId, writable } = resolveSpecFieldId(spec, fields);
    let uniqueId = resolvedId;
    const matched = uniqueId
      ? fields.find((f) => f.uniqueId?.trim() === uniqueId)
      : undefined;
    if (spec.kind === "file" && uniqueId && !isPocketFileField(matched)) {
      uniqueId = null;
    }
    result[key] = {
      spec,
      uniqueId,
      writable: uniqueId ? writable : false,
    };
  }
  return result;
}

export function apoAcquisitionDefaultEstimateStatus(): string {
  return process.env.APO_ACQUISITION_DEFAULT_ESTIMATE_STATUS?.trim() || "新規";
}
