/** フォーム内部キー（@pocket uniqueId とは別） */
export type CustomerInfoFormKey = string;

export type CustomerInfoFieldType =
  | "text"
  | "date"
  | "select"
  | "radio"
  | "checkbox-group"
  /** 整数のみ・画面はカンマ区切り表示 */
  | "pt-integer"
  /** 整数のみ・画面はカンマ区切り・@pocket はカンマなし */
  | "comma-integer"
  /** 000-0000 形式の郵便番号 */
  | "postal-code"
  /** 小数点以下最大3桁・四捨五入なし（太陽光パネル容量 kW 等） */
  | "decimal-kw";

export type CustomerInfoFormFieldDef = {
  key: CustomerInfoFormKey;
  /** @pocket 列見出し（完全一致で uniqueId を解決）。liffOnly のときは未使用 */
  caption: string;
  /** LIFF 表示名（liffOnly や caption と異なるラベル用） */
  formLabel?: string;
  /** true のとき @pocket へは保存せず LIFF の表示制御のみ */
  liffOnly?: boolean;
  /** true のとき入力フォームに出さない（保存時にサーバーで @pocket へ転記） */
  hiddenInForm?: boolean;
  type: CustomerInfoFieldType;
  options?: readonly string[];
  /** 選択肢は後日 @pocket 連携予定のとき true（当面はテキスト入力） */
  optionsPending?: boolean;
  /** 非表示時に @pocket へ送る値（既定 "-"） */
  hiddenValue?: string;
  /** false のとき未入力でも保存可（省略時は必須） */
  required?: boolean;
};

export type CustomerInfoFormFieldResolved = CustomerInfoFormFieldDef & {
  /** liffOnly のときは空文字 */
  fieldId: string;
  label: string;
  value: string;
};

export type CustomerInfoFormValues = Record<CustomerInfoFormKey, string>;
