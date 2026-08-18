import { formatBatteryCapacityLine } from "@/lib/construction-request-template";
import { INPUT_STATUS_COMPLETE } from "@/lib/customer-info-form/options";
import { formatCommaInteger } from "@/lib/customer-info-form/numeric-comma";
import {
  computePtTransfer,
  normApClStaffName,
} from "@/lib/customer-info-form/pt-transfer";
import { formatDisplayYmd } from "@/lib/format-display-ymd";
import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";

/**
 * 契約速報（タスクR）の通知本文を組み立てる純粋関数。
 *
 * 値が空でも**行は残す**。行ごと消すと、何が未入力なのか受け取り側に
 * 伝わらない（新規施工依頼のテンプレート＝タスクH と同じ扱い）。
 */

/**
 * 蓄電池行の先頭に固定で入れる文言。
 *
 * @pocket に該当する列は無く、運用上つねに全負荷型のため固定文字列とする
 * （タスクR の確認で決定）。列が増えたらここを差し替える。
 */
export const CONTRACT_NOTIFICATION_BATTERY_LOAD_TYPE = "全負荷";

/**
 * お客様情報フォーム（schema.ts）に定義が無く、通知のためだけに読む列。
 *
 * 解決は既存方式（CUSTOMER_INFO_FIELD_* を優先し、未設定なら見出し完全一致）
 * に揃える。ここでは見出しだけを持ち、解決自体は resolve-fields.ts を使う。
 */
export const CONTRACT_NOTIFICATION_EXTRA_FIELDS = [
  { key: "tNumber", caption: "T番号" },
  { key: "batteryLocation", caption: "蓄電池設置箇所" },
] as const;

export type ContractNotificationExtraValues = {
  /** 見出し「T番号」 */
  tNumber: string;
  /** 見出し「蓄電池設置箇所」 */
  batteryLocation: string;
};

export type ContractNotificationInput = {
  /** これから保存する値 */
  values: CustomerInfoFormValues;
} & ContractNotificationExtraValues;

/**
 * 入力ステータスの比較用の正規化。
 *
 * NFKC＋空白正規化は既存の normApClStaffName と同じ規則で、
 * 新しく書かずにそれをそのまま使う。
 */
export function normalizeInputStatus(raw: string | null | undefined): string {
  return normApClStaffName(raw ?? undefined);
}

/**
 * 「未入力 → 入力完了」に変わったときだけ true。
 *
 * - すでに「入力完了」の案件を再保存しても送らない（同じ案件で何度も飛ぶのを防ぐ）
 * - 「入力完了 → 未入力」でも送らない
 * - 保存前の値が読めなかった（null）ときも送らない。重複通知より取りこぼしを選ぶ
 */
export function shouldSendContractNotification(
  beforeInputStatus: string | null | undefined,
  afterInputStatus: string | null | undefined,
): boolean {
  if (beforeInputStatus == null) return false;
  const before = normalizeInputStatus(beforeInputStatus);
  const after = normalizeInputStatus(afterInputStatus);
  const complete = normalizeInputStatus(INPUT_STATUS_COMPLETE);
  return after === complete && before !== complete;
}

/** @pocket の「未入力」表現（"-"）は通知に出さない */
function plain(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  return t === "-" ? "" : t;
}

/**
 * 金額を3桁区切りにする。
 *
 * 追加部材の金額は自由入力（text 列）で「一式」等が入りうる。
 * 数字だけの値のときに限ってカンマを入れ、それ以外は加工せず通す。
 */
export function formatContractAmount(raw: string | null | undefined): string {
  const t = plain(raw);
  if (!t) return "";
  const digits = t.normalize("NFKC").replace(/[,\s]/g, "");
  if (!/^\d+$/.test(digits)) return t;
  return formatCommaInteger(digits);
}

/** 契約日は表示用 yyyy/mm/dd。解釈できない値はそのまま通す */
function formatContractDate(raw: string | null | undefined): string {
  const t = plain(raw);
  if (!t) return "";
  return formatDisplayYmd(t) || t;
}

/** 都道府県 + 市区郡 + 町村+番地 を連結する */
function buildInstallationAddress(values: CustomerInfoFormValues): string {
  return [
    plain(values.prefecture),
    plain(values.city),
    plain(values.address),
  ]
    .filter(Boolean)
    .join("");
}

/** （パネル品番① + パネル品番②）パネル枚数① + パネル枚数② */
function buildSolarLine(values: CustomerInfoFormValues): string {
  const models = [plain(values.panelModel1), plain(values.panelModel2)]
    .filter(Boolean)
    .join(" + ");
  const counts = [plain(values.panelCount1), plain(values.panelCount2)]
    .filter(Boolean)
    .join(" + ");
  return `${models ? `（${models}）` : ""}${counts}`;
}

/** パワコン品番① + パワコン品番② */
function buildPowerConModelLine(values: CustomerInfoFormValues): string {
  return [plain(values.powerConModel1), plain(values.powerConModel2)]
    .filter(Boolean)
    .join(" + ");
}

/** 全負荷、蓄電池容量① + 蓄電池容量②、蓄電池設置箇所 */
function buildBatteryLine(
  values: CustomerInfoFormValues,
  batteryLocation: string,
): string {
  return [
    CONTRACT_NOTIFICATION_BATTERY_LOAD_TYPE,
    formatBatteryCapacityLine(values.batteryCapacity1, values.batteryCapacity2),
    plain(batteryLocation),
  ]
    .filter(Boolean)
    .join("、");
}

export function buildContractNotificationText(
  input: ContractNotificationInput,
): string {
  const { values } = input;
  const pt = computePtTransfer(values);

  const lines: string[] = [
    "【契約速報】",
    `T番号：${plain(input.tNumber)}`,
    `契約日：${formatContractDate(values.contractDate)}`,
    `AP担当者：${plain(values.apStaff)}`,
    `APPT：${formatContractAmount(pt.appt)}`,
    `CL担当者：${plain(values.clStaff)}`,
    `CLPT：${formatContractAmount(pt.clpt)}`,
    `お客様名：${plain(values.customerName)}`,
    `フリガナ：${plain(values.furigana)}`,
    // 〒 は固定で付ける。値が空なら「郵便番号：〒」だけ残る
    `郵便番号：〒${plain(values.postalCode)}`,
    `設置住所：${buildInstallationAddress(values)}`,
    `契約者電話番号：${plain(values.phone)}`,
    `導入経緯：${plain(values.introduction)}`,
    `太陽光：${buildSolarLine(values)}`,
    `パワコン台数：${plain(values.powerConCount)}`,
    `パワコン品番：${buildPowerConModelLine(values)}`,
    `蓄電池：${buildBatteryLine(values, input.batteryLocation)}`,
    `屋根材：${plain(values.roofMaterial)}`,
    // @pocket の列名は「屋根材品番」
    `屋根材詳細：${plain(values.roofMaterialModel)}`,
    `FIT適用有無：${plain(values.fitType)}`,
    `現在の電力会社：${plain(values.contractPowerCompany)}`,
    `電気契約プラン名：${plain(values.contractPowerPlan)}`,
    `化粧カバー：${plain(values.cosmeticCover)}`,
    `分電盤アンペア：${plain(values.breakerAmps)}`,
    `支払方法：${plain(values.paymentMethod)}`,
    `信販会社：${plain(values.creditCompany)}`,
    `契約金額：${formatContractAmount(values.contractAmount)}`,
    `現金：${formatContractAmount(values.cashAmount)}`,
    `ローン金額：${formatContractAmount(values.loanAmount)}`,
    // @pocket の列名は「追加部材の商品名」
    `追加部材：${plain(values.extraPartsName)}`,
    `追加部材URL：${plain(values.extraPartsUrl)}`,
    `追加部材の金額：${formatContractAmount(values.extraPartsAmount)}`,
    // 設置種別の値をそのまま出す
    `創蓄or蓄単or太単：${plain(values.installationType)}`,
    `補助金：${plain(values.subsidy)}`,
    `事前申請有無：${plain(values.preApplication)}`,
  ];

  return lines.join("\n");
}
