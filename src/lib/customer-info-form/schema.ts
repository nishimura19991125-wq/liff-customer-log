import type { CustomerInfoFormFieldDef } from "@/lib/customer-info-form/types";

const YES_NO = ["無", "有"] as const;

export const INSTALLATION_TYPE_OPTIONS = [
  "太陽光パネル+蓄電池",
  "蓄電池のみ",
  "太陽光パネルのみ",
  "パワコン取替のみ",
] as const;

export const ROOF_MATERIAL_OPTIONS = [
  "金属縦平葺き",
  "カラーベスト",
  "アスファルトシングル",
  "平板瓦",
  "洋瓦",
  "和瓦",
  "金属横葺",
  "その他",
] as const;

export const COSMETIC_COVER_OPTIONS = [
  "黒",
  "白",
  "アイボリー",
  "ブラウン",
  "グレー",
  "新築のため未定",
  "無",
] as const;

/** お客様情報入力フォーム定義（見出しは @pocket 列名と一致させる） */
export const CUSTOMER_INFO_FORM_FIELDS: readonly CustomerInfoFormFieldDef[] = [
  { key: "customerName", caption: "お客様名", type: "text" },
  { key: "pt", caption: "PT", type: "pt-integer" },
  { key: "apStaff", caption: "AP担当者", type: "text" },
  { key: "clStaff", caption: "CL担当者", type: "text" },
  { key: "introduction", caption: "導入経緯", type: "text" },
  { key: "firstContractDate", caption: "初回契約日", type: "date" },
  { key: "contractDate", caption: "契約日", type: "date" },
  { key: "furigana", caption: "フリガナ", type: "text" },
  { key: "phone", caption: "電話番号", type: "text" },
  {
    key: "installationType",
    caption: "設置種別",
    type: "select",
    options: [...INSTALLATION_TYPE_OPTIONS],
  },
  {
    key: "manufacturer",
    caption: "メーカー",
    type: "select",
    options: [],
    optionsPending: true,
  },
  {
    key: "panelCombo",
    caption: "",
    formLabel: "パネルの組み合わせ",
    type: "select",
    options: [...YES_NO],
    liffOnly: true,
  },
  {
    key: "panelModel1",
    caption: "太陽光パネル品番",
    type: "select",
    options: [],
    optionsPending: true,
  },
  {
    key: "panelModel2",
    caption: "太陽光パネル品番②",
    type: "select",
    options: [],
    optionsPending: true,
  },
  {
    key: "panelCount1",
    caption: "パネル枚数①",
    type: "select",
    options: [],
    optionsPending: true,
  },
  {
    key: "panelCount2",
    caption: "パネル枚数②",
    type: "select",
    options: [],
    optionsPending: true,
  },
  {
    key: "powerConCount",
    caption: "パワーコンディショナー台数",
    type: "select",
    options: ["1", "2"],
  },
  {
    key: "powerConModel1",
    caption: "パワーコンディショナー品番",
    type: "select",
    options: [],
    optionsPending: true,
  },
  {
    key: "powerConModel2",
    caption: "パワーコンディショナー品番②",
    type: "select",
    options: [],
    optionsPending: true,
  },
  {
    key: "batteryMulti",
    caption: "蓄電池複数台設置",
    type: "select",
    options: [...YES_NO],
  },
  {
    key: "batteryCapacity1",
    caption: "蓄電池容量(kWh)",
    type: "select",
    options: [],
    optionsPending: true,
  },
  {
    key: "batteryCapacity2",
    caption: "蓄電池容量(kWh)②",
    type: "select",
    options: [],
    optionsPending: true,
  },
  {
    key: "ecoCuteNew",
    caption: "エコキュート新規設置",
    type: "select",
    options: [...YES_NO],
  },
  { key: "ihNew", caption: "IH新規設置", type: "select", options: [...YES_NO] },
  { key: "v2hNew", caption: "V2H新規設置", type: "select", options: [...YES_NO] },
  { key: "ecoCuteModel", caption: "エコキュート型番", type: "text" },
  { key: "ihModel", caption: "IH型番", type: "text" },
  { key: "v2hModel", caption: "V2H型番", type: "text" },
  {
    key: "breakerAmps",
    caption: "分電盤アンペア数",
    type: "select",
    options: ["50A", "60A", "75A", "100A", "新築の為未定"],
  },
  {
    key: "roofMaterial",
    caption: "屋根材",
    type: "select",
    options: [...ROOF_MATERIAL_OPTIONS],
  },
  { key: "roofMaterialModel", caption: "屋根材品番", type: "text" },
  {
    key: "cosmeticCover",
    caption: "化粧カバー",
    type: "checkbox-group",
    options: [...COSMETIC_COVER_OPTIONS],
  },
  {
    key: "extraParts",
    caption: "追加部材の有無",
    type: "select",
    options: [...YES_NO],
  },
  { key: "extraPartsUrl", caption: "追加部材URL", type: "text" },
  { key: "extraPartsName", caption: "追加部材の商品名", type: "text" },
  { key: "extraPartsAmount", caption: "追加部材の金額", type: "text" },
];

export const CUSTOMER_INFO_FORM_FIELD_MAP = new Map(
  CUSTOMER_INFO_FORM_FIELDS.map((f) => [f.key, f] as const),
);

export function customerInfoFormFieldKeys(): string[] {
  return CUSTOMER_INFO_FORM_FIELDS.map((f) => f.key);
}
