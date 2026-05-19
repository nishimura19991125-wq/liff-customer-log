/** フォーム内部キー（@pocket uniqueId とは別） */
export type CustomerInfoFormKey = string;

export type CustomerInfoFieldType =
  | "text"
  | "date"
  | "select"
  | "checkbox-group"
  /** 整数のみ・画面はカンマ区切り表示 */
  | "pt-integer";

export type CustomerInfoFormFieldDef = {
  key: CustomerInfoFormKey;
  /** @pocket 列見出し（完全一致で uniqueId を解決） */
  caption: string;
  type: CustomerInfoFieldType;
  options?: readonly string[];
  /** 選択肢は後日 @pocket 連携予定のとき true（当面はテキスト入力） */
  optionsPending?: boolean;
  /** 非表示時に @pocket へ送る値（既定 "-"） */
  hiddenValue?: string;
};

export type CustomerInfoFormFieldResolved = CustomerInfoFormFieldDef & {
  fieldId: string;
  label: string;
  value: string;
};

export type CustomerInfoFormValues = Record<CustomerInfoFormKey, string>;
