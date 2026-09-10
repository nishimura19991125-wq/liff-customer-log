import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";

export const PAYMENT_METHOD_OPTIONS = [
  "ソーラーローン",
  "頭金+ソーラーローン",
  "現金一括",
  "住宅ローン組込",
  "提携先より振込",
] as const;

/**
 * 売電方式（@pocket「FIT or 非FIT」列）。
 * **@pocket の実物と1文字も変えないこと。** 値がズレると、画面のリストが
 * 未選択に見えるのに値だけ入る状態になる（書類16項目と同じ事故）。
 */
export const FIT_TYPE_OPTIONS = ["FIT", "非FIT"] as const;

/**
 * 書類の一部（NON_FIT_HIDDEN_DOCUMENT_KEYS）を非表示にする売電方式。
 * FIT_TYPE_OPTIONS の実物と同じ文字列を指すこと。
 */
export const FIT_TYPE_NON_FIT = "非FIT" as const;

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

/**
 * 顧客ステータス（@pocket リスト式）。
 *
 * **@pocket の実物と並び・値を一致させること。** 選択肢がズレていると、
 * 画面のリストが未選択に見えるのに値だけが入る状態になり、タスクG の
 * 書類16項目と同じ事故が起きる。customer-info-form-options.test.ts で
 * 既定値・キャンセル値が選択肢に含まれることを固定している。
 */
export const CUSTOMER_STATUS_OPTIONS = [
  "工事待ち",
  "完工",
  "残工",
  "完了",
  "キャンセル",
] as const;

/** 顧客ステータスの初期値（未設定のレコードを開いたときの既定選択） */
export const CUSTOMER_STATUS_DEFAULT = "工事待ち" as const;

/** 未設定なら初期値（工事待ち）を返す */
export function customerStatusWithDefault(
  value: string | null | undefined,
): string {
  const t = (value ?? "").trim();
  return t || CUSTOMER_STATUS_DEFAULT;
}

/**
 * 導入経緯（@pocket リスト式）。
 *
 * **@pocket の実物と値を一致させること。** 値がズレていると、画面のリストが
 * 未選択に見えるのに値だけが入る状態になる（書類16項目と同じ事故）。
 *
 * ⚠ 並び順は @pocket の実物と突き合わせていない。「お取引先様からの紹介」は
 *   位置が判断できなかったため末尾に足してある。@pocket 側の並びが分かった
 *   時点でそろえてよい（並びは表示順を決めるだけで、判定には影響しない）。
 */
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
  "お取引先様からの紹介",
] as const;

/**
 * 紹介元・紹介手数料を表示する導入経緯（条件A）。
 *
 * **@pocket の実物と1文字も変えないこと。** 値がズレると、その導入経緯を
 * 選んだときに欄が出ない（気づきにくい形で入力が落ちる）。
 *
 * 6値とも INTRODUCTION_ROUTE_OPTIONS に存在する（画面から選べる）。
 */
export const INTRODUCTION_ROUTES_WITH_REFERRAL_SOURCE = new Set<string>([
  "(DC)工務店OBリスト",
  "ソーラーパートナーズ",
  "タイナビ",
  "工務店トスアップ",
  "お客様紹介",
  "お取引先様からの紹介",
]);

/**
 * 条件A の対象キー（紹介元・紹介手数料）。
 *
 * **項目を増やすときはこの集合だけを直すこと。** 表示・必須・保存・
 * 非表示時の既定値適用が、すべてこの集合と shouldShowReferralSourceFields を
 * 参照する。条件W（NON_FIT_HIDDEN_DOCUMENT_KEYS）と同じ構造。
 */
export const REFERRAL_SOURCE_FIELD_KEYS: ReadonlySet<string> = new Set([
  "referralSource",
  "referralFee",
]);

/** 工務店名またはトラーチ倶楽部を表示・必須にする導入経緯 */
export const INTRODUCTION_ROUTES_REQUIRING_BUILDER_NAME = new Set<string>([
  "(DC)工務店OBリスト",
  "工務店トスアップ",
  "トラーチ倶楽部",
  "卸案件",
  "お客様紹介",
]);

/**
 * 条件A：紹介元・紹介手数料を表示するか。
 *
 * **表示・必須・保存の3つを必ずこの1関数から導くこと。**
 * 項目ごとに条件を書き分けると、足すたびに直す箇所が増え、
 * どこか1つ漏れた時点で「画面に出ていない値が保存される」事故になる。
 *
 * 未選択（空）のときは表示しない。上記6つを選んだときだけ表示する。
 * 比較は trim のみで NFKC 正規化はしない（設置種別・支払方法・売電方式など
 * 他の選択肢の比較と同じ作法。NFKC を掛けているのは室内現調ステータスだけ）。
 */
export function shouldShowReferralSourceFields(
  values: CustomerInfoFormValues,
): boolean {
  return INTRODUCTION_ROUTES_WITH_REFERRAL_SOURCE.has(
    (values.introduction ?? "").trim(),
  );
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

/**
 * 書類回収状況（無あり）。
 * ⚠ 2択の COLLECTION_STATUS_TWO_OPTIONS は廃止した。
 *   @pocket の実物は書類16項目すべてに「不要」があり、2択の定義を当てていた
 *   6項目では、hiddenValue の「不要」が自分の選択肢に無いという矛盾が起きていた。
 *   その結果ラジオが未選択に見え、値だけが「不要」のまま保存され続けていた。
 */
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

/**
 * 配線方式（@pocket「配線方式」列）を表示する設置種別。
 * **@pocket の実物と1文字も変えないこと**（値がズレると、画面のリストが
 * 未選択に見えるのに値だけ入る事故になる）。
 */
export const INSTALLATION_TYPES_WITH_WIRING_METHOD = new Set<string>([
  "太陽光パネル+蓄電池",
  "蓄電池のみ",
]);

/**
 * 配線方式を表示するか。
 *
 * **表示・必須・保存の3つを必ずこの1関数から導くこと。**
 * 表示条件と保存条件を別々に書くと、アポキャン時と同じ
 * 「画面に出ていない値が保存時に書き込まれる」事故になる。
 * 前後の空白は落とす（設置種別の他の判定と同じ扱い）。
 */
export function shouldShowWiringMethod(installationType: string): boolean {
  return INSTALLATION_TYPES_WITH_WIRING_METHOD.has(installationType.trim());
}

/**
 * 売電方式が「非FIT」のとき非表示にする書類（条件W）。
 *
 * **項目を増やすときはこの集合だけを直すこと。** 表示・必須・保存・
 * 非表示時の既定値適用は、すべてこの集合と shouldShowNonFitHiddenDocuments を
 * 参照している。isCustomerInfoFormFieldVisible にも key ごとの分岐は書かない
 * （switch の手前でこの集合をまとめて見る）。
 *
 * 項目ごとに条件を書き分けると、足すたびに直す箇所が増え、
 * どこか1つ漏れた時点で「画面に出ていない値が保存される」事故に戻る。
 */
export const NON_FIT_HIDDEN_DOCUMENT_KEYS: ReadonlySet<string> = new Set([
  // 印鑑登録証明書
  "sealRegistrationCertificate",
  // 委任状3項目
  "powerOfAttorneyStorage",
  "powerOfAttorneyChangeCert",
  "powerOfAttorneyIdPassword",
  // 同意書3項目
  "equipmentCertConsent",
  "operatingCostReportConsent",
  "freeUseGenerationConsent",
]);

/**
 * 条件W：NON_FIT_HIDDEN_DOCUMENT_KEYS の書類を表示するか（売電方式の観点のみ）。
 *
 * **表示・必須・保存の3つを必ずこの1関数から導くこと。**
 * 表示条件と保存条件を別々に書くと、書類16項目で起きたのと同じ
 * 「画面に出ていない値が保存時に書き込まれる」事故になる。
 *
 * 設置種別による既存の条件（条件T／条件U）はここでは見ない。
 * 呼び出し側（isCustomerInfoFormFieldVisible）で AND を取る。
 *
 * 未選択（空）のときは表示する。「非FIT」を選んだときだけ隠す。
 * 比較は trim のみで NFKC 正規化はしない（設置種別・支払方法など
 * 他の選択肢の比較と同じ作法。NFKC を掛けているのは室内現調ステータスだけ）。
 */
export function shouldShowNonFitHiddenDocuments(
  values: CustomerInfoFormValues,
): boolean {
  return (values.fitType ?? "").trim() !== FIT_TYPE_NON_FIT;
}

/** 付近見取り図 */
export const VICINITY_SKETCH_OPTIONS = [
  "未作成",
  "作成済み",
  "不要",
] as const;

/** 登記簿 */
export const REGISTRY_BOOK_OPTIONS = ["未確認", "確認済み", "不要"] as const;

/**
 * 補助金事前申請書類。
 * 「一部回収済み」は運用上廃止し、@pocket の列からも削除済み。
 * 内容は COLLECTION_STATUS_WITH_UNNECESSARY_OPTIONS と同じだが、
 * この項目だけ選択肢が変わる可能性があるため定数は分けたままにしている。
 */
export const SUBSIDY_PRE_APPLICATION_DOC_OPTIONS = [
  "未回収",
  "回収済み",
  "不要",
] as const;

/** 書類ラジオ：非表示時の既定値 */
export const DOCUMENT_RADIO_HIDDEN_VALUE = "不要";

/** 施工依頼ステータス（タスクH）。書類16項目ではないので書類系の判定には関わらない */
export const CONSTRUCTION_REQUEST_STATUS_OPTIONS = ["未", "済"] as const;

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
