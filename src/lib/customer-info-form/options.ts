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

export function isIndoorSurveyStatusNotDone(
  value: string | null | undefined,
): boolean {
  return (value ?? "").normalize("NFKC").trim() === "未実施";
}

/** お客様情報の入力ステータス（@pocket リスト式） */
export const INPUT_STATUS_OPTIONS = ["未入力", "入力完了"] as const;

/** 顧客ステータス（@pocket リスト式） */
export const CUSTOMER_STATUS_OPTIONS = ["工事待ち", "キャンセル"] as const;

/** 顧客ステータスの初期値（未設定のレコードを開いたときの既定選択） */
export const CUSTOMER_STATUS_DEFAULT = "工事待ち" as const;

/** 未設定なら初期値（工事待ち）を返す */
export function customerStatusWithDefault(
  value: string | null | undefined,
): string {
  const t = (value ?? "").trim();
  return t || CUSTOMER_STATUS_DEFAULT;
}

/** 導入経緯（@pocket リスト式） */
export const INTRODUCTION_ROUTE_OPTIONS = [
  "ダイレクト",
  "(DC)工務店OBリスト",
  "ソーラーパートナーズ",
  "タイナビ",
  "工務店トスアップ",
  "トラーチ倶楽部",
  "卸案件",
  "お客様紹介",
  "HP",
  "SNS",
  "トレンディ",
  "大和ハウス",
  "産業用",
] as const;

/** 紹介手数料を表示・必須にする導入経緯 */
export const INTRODUCTION_ROUTES_REQUIRING_REFERRAL_FEE = new Set<string>([
  "(DC)工務店OBリスト",
  "ソーラーパートナーズ",
  "タイナビ",
  "工務店トスアップ",
]);

/** 工務店名またはトラーチ倶楽部を表示・必須にする導入経緯 */
export const INTRODUCTION_ROUTES_REQUIRING_BUILDER_NAME = new Set<string>([
  "(DC)工務店OBリスト",
  "工務店トスアップ",
  "トラーチ倶楽部",
  "卸案件",
  "お客様紹介",
]);

export function introductionRequiresReferralFee(introduction: string): boolean {
  return INTRODUCTION_ROUTES_REQUIRING_REFERRAL_FEE.has(introduction.trim());
}

export function introductionRequiresBuilderName(introduction: string): boolean {
  return INTRODUCTION_ROUTES_REQUIRING_BUILDER_NAME.has(introduction.trim());
}

export const INPUT_STATUS_PENDING = "未入力" as const;
export const INPUT_STATUS_COMPLETE = "入力完了" as const;

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

/** パネル組み合わせ・品番・枚数・容量を非表示にする設置種別（品番は "-"・枚数・容量は半角 0） */
export const INSTALLATION_TYPES_HIDE_PANEL = new Set<string>([
  "蓄電池のみ",
  "パワコン取替のみ",
]);

/** 蓄電池複数台・蓄電池容量を非表示にする設置種別（容量・品番は "-"） */
export const INSTALLATION_TYPES_HIDE_BATTERY = new Set<string>([
  "太陽光パネルのみ",
  "パワコン取替のみ",
]);

export function installationTypeHidesPanelSection(
  installationType: string | undefined,
): boolean {
  return INSTALLATION_TYPES_HIDE_PANEL.has((installationType ?? "").trim());
}

export function installationTypeHidesBatterySection(
  installationType: string | undefined,
): boolean {
  return INSTALLATION_TYPES_HIDE_BATTERY.has((installationType ?? "").trim());
}

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
  "回収済み",
  "不要",
] as const;

/** 書類ラジオ：非表示時の既定値 */
export const DOCUMENT_RADIO_HIDDEN_VALUE = "不要";

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
