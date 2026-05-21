import {
  FIT_TYPE_OPTIONS,
  INDOOR_SURVEY_STATUS_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  SUBSIDY_OR_PREAPPLICATION_OPTIONS,
} from "@/lib/customer-info-form/options";
import type { CustomerInfoFormFieldDef } from "@/lib/customer-info-form/types";

const YES_NO = ["無", "有"] as const;

export const INSTALLATION_TYPE_OPTIONS = [
  "太陽光パネル+蓄電池",
  "蓄電池のみ",
  "太陽光パネルのみ",
  "パワコン取替のみ",
] as const;

export const ROOF_MATERIAL_OPTIONS = [
  "金属縦平葺",
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
  {
    key: "pt",
    caption: "",
    formLabel: "PT",
    type: "pt-integer",
    liffOnly: true,
  },
  { key: "apStaff", caption: "AP担当者", type: "text" },
  { key: "clStaff", caption: "CL担当者", type: "text" },
  { key: "introduction", caption: "導入経緯", type: "text" },
  { key: "firstContractDate", caption: "初回契約日", type: "date" },
  { key: "contractDate", caption: "契約日", type: "date" },
  { key: "furigana", caption: "フリガナ", type: "text" },
  { key: "phone", caption: "電話番号", type: "text" },
  { key: "postalCode", caption: "郵便番号", type: "postal-code" },
  { key: "prefecture", caption: "都道府県", type: "text" },
  { key: "city", caption: "市区郡", type: "text" },
  { key: "address", caption: "町村+番地", type: "text" },
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
    /** 取引先会社一覧アプリから API 取得時に options を差し替え */
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
    caption: "太陽光パネル型番①",
    formLabel: "パネル品番①",
    type: "select",
    options: [],
    /** 商品一覧(型番詳細)から API 取得（メーカー選択後） */
    optionsPending: true,
  },
  {
    key: "panelModel2",
    caption: "太陽光パネル型番②",
    formLabel: "パネル品番②",
    type: "select",
    options: [],
    optionsPending: true,
  },
  { key: "panelCount1", caption: "パネル枚数①", type: "comma-integer" },
  { key: "panelCount2", caption: "パネル枚数②", type: "comma-integer" },
  {
    key: "powerConCount",
    caption: "パワーコンディショナー台数",
    formLabel: "パワコン設置台数",
    type: "select",
    options: ["1", "2"],
  },
  {
    key: "powerConModel1",
    caption: "パワーコンディショナー品番①",
    formLabel: "パワコン品番①",
    type: "select",
    options: [],
    /** 商品一覧(型番詳細)から API 取得（メーカー選択後） */
    optionsPending: true,
  },
  {
    key: "powerConModel2",
    caption: "パワーコンディショナー品番②",
    formLabel: "パワコン品番②",
    type: "select",
    options: [],
    optionsPending: true,
  },
  {
    key: "batteryMulti",
    caption: "",
    formLabel: "蓄電池複数台設置",
    type: "select",
    options: [...YES_NO],
    liffOnly: true,
  },
  {
    key: "batteryCapacity1",
    caption: "蓄電池容量(kWh)①",
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
  {
    key: "paymentMethod",
    caption: "支払方法",
    type: "select",
    options: [...PAYMENT_METHOD_OPTIONS],
  },
  {
    key: "creditCompany",
    caption: "信販会社",
    type: "select",
    options: [],
    optionsPending: true,
  },
  { key: "contractAmount", caption: "契約金額", type: "comma-integer" },
  { key: "cashAmount", caption: "現金", type: "comma-integer" },
  { key: "loanAmount", caption: "ローン金額", type: "comma-integer" },
  {
    key: "fitType",
    caption: "FIT or 非FIT",
    type: "select",
    options: [...FIT_TYPE_OPTIONS],
  },
  {
    key: "subsidy",
    caption: "補助金有無",
    formLabel: "補助金",
    type: "select",
    options: [...SUBSIDY_OR_PREAPPLICATION_OPTIONS],
  },
  { key: "prefectureSubsidy", caption: "都道府県補助金", type: "text" },
  { key: "citySubsidy", caption: "市区町村補助金", type: "text" },
  { key: "otherSubsidy", caption: "その他補助金", type: "text" },
  {
    key: "preApplication",
    caption: "事前申請有無",
    formLabel: "事前申請",
    type: "select",
    options: [...SUBSIDY_OR_PREAPPLICATION_OPTIONS],
  },
  {
    key: "indoorSurveyStatus",
    caption: "室内現地調査実施状況",
    type: "select",
    options: [...INDOOR_SURVEY_STATUS_OPTIONS],
  },
  {
    key: "indoorSurveyScheduledDate",
    caption: "室内現調予定日",
    type: "date",
  },
  {
    key: "pinpointAddress",
    caption: "ピンポイント住所",
    type: "text",
  },
];

export const CUSTOMER_INFO_FORM_FIELD_MAP = new Map(
  CUSTOMER_INFO_FORM_FIELDS.map((f) => [f.key, f] as const),
);

export function customerInfoFormFieldKeys(): string[] {
  return CUSTOMER_INFO_FORM_FIELDS.map((f) => f.key);
}
