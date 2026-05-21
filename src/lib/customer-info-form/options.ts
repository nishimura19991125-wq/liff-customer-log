export const PAYMENT_METHOD_OPTIONS = [
  "ソーラーローン",
  "頭金+ソーラーローン",
  "現金一括",
  "住宅ローン組込",
  "提携先より振込",
] as const;

export const FIT_TYPE_OPTIONS = ["FIT", "非FIT"] as const;

export const SUBSIDY_OR_PREAPPLICATION_OPTIONS = [
  "無",
  "都道府県+市区町村",
  "都道府県",
  "市区町村",
  "その他",
  "都道府県+市区町村+その他",
  "市区町村+その他",
  "都道府県+その他",
] as const;

export const INDOOR_SURVEY_STATUS_OPTIONS = ["未実施", "実施済み"] as const;

export const PAYMENT_METHODS_WITH_LOAN = new Set<string>([
  "ソーラーローン",
  "頭金+ソーラーローン",
]);

export const PAYMENT_METHODS_WITH_CASH = new Set<string>([
  "頭金+ソーラーローン",
  "現金一括",
]);

/** 書類回収状況（2択ラジオ） */
export const COLLECTION_STATUS_TWO_OPTIONS = ["未回収", "回収済み"] as const;

/** 書類回収状況（無あり） */
export const COLLECTION_STATUS_WITH_NONE_OPTIONS = [
  "未回収",
  "回収済み",
  "無",
] as const;

/** 書類回収状況（不要あり） */
export const COLLECTION_STATUS_WITH_UNNECESSARY_OPTIONS = [
  "未回収",
  "回収済み",
  "不要",
] as const;

export const INSTALLATION_TYPES_WITH_SOLAR_PANEL = new Set<string>([
  "太陽光パネル+蓄電池",
  "太陽光パネルのみ",
]);

export const INSTALLATION_TYPES_BATTERY_OR_POWERCON_ONLY = new Set<string>([
  "蓄電池のみ",
  "パワコン取替のみ",
]);

/** 付近見取り図 */
export const VICINITY_SKETCH_OPTIONS = [
  "未作成",
  "作成済み",
  "不要",
] as const;

/** 登記簿 */
export const REGISTRY_BOOK_OPTIONS = ["未確認", "確認済み"] as const;

/** 補助金事前申請書類 */
export const SUBSIDY_PRE_APPLICATION_DOC_OPTIONS = [
  "未回収",
  "一部回収済み",
  "回収済み",
] as const;

/** 書類ラジオ：非表示時の既定値 */
export const DOCUMENT_RADIO_HIDDEN_VALUE = "不要";

/** ローン用紙：非表示時（現金一括系） */
export const LOAN_PAPER_HIDDEN_VALUE = "現金一括の為、不要";

export function preApplicationRequiresDocuments(
  preApplication: string | undefined,
): boolean {
  const v = (preApplication ?? "").trim();
  return v !== "" && v !== "無";
}

export function subsidyIncludesPrefecture(s: string): boolean {
  return (
    s === "都道府県+市区町村" ||
    s === "都道府県" ||
    s === "都道府県+市区町村+その他" ||
    s === "都道府県+その他"
  );
}

export function subsidyIncludesCity(s: string): boolean {
  return (
    s === "都道府県+市区町村" ||
    s === "市区町村" ||
    s === "都道府県+市区町村+その他" ||
    s === "市区町村+その他"
  );
}

export function subsidyIncludesOther(s: string): boolean {
  return (
    s === "その他" ||
    s === "都道府県+市区町村+その他" ||
    s === "市区町村+その他" ||
    s === "都道府県+その他"
  );
}
