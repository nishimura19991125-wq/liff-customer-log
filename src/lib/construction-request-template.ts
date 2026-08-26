import { checkboxGroupValueToPocketArray } from "@/lib/customer-info-form/checkbox-pocket";
import {
  installationTypeHidesBatterySection,
  installationTypeHidesPanelSection,
} from "@/lib/customer-info-form/options";
import { isSameApClStaff } from "@/lib/customer-info-form/pt-transfer";
import { formatCustomerNameForDisplay } from "@/lib/customer-name-display";
import {
  COSMETIC_COVER_OPTIONS,
  INSTALLATION_TYPE_OPTIONS,
} from "@/lib/customer-info-form/schema";
import { formatYmdWithWeekday } from "@/lib/format-weekday-date";
import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";

/**
 * 新規施工依頼の定型フォーマットを組み立てる純粋関数（タスクH）。
 *
 * 値が空でも**行は残す**。行ごと消すと、何が未入力なのか受け取り側に伝わらない。
 */

/** 施工依頼ステータスの完了値 */
export const CONSTRUCTION_REQUEST_STATUS_DONE = "済";

/** 1行目の「【…】」内で工事種別と施工予定日を区切る全角スペース */
const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);


/**
 * 設置種別 → 工事種別の表記。
 *
 * INSTALLATION_TYPE_OPTIONS の4種類すべてを網羅する。網羅漏れがあると
 * constructionWorkTypeLabel が null を返し、呼び出し側がテンプレートを出さない。
 */
const WORK_TYPE_BY_INSTALLATION_TYPE: ReadonlyMap<string, string> = new Map([
  ["太陽光パネル+蓄電池", "創蓄工事"],
  ["蓄電池のみ", "蓄単工事"],
  ["太陽光パネルのみ", "太陽光単体工事"],
  ["パワコン取替のみ", "パワコン取替工事"],
]);

/** 設置種別の定義とこの対応表がずれていないか（テストで検証する） */
export function installationTypesWithoutWorkType(): string[] {
  return INSTALLATION_TYPE_OPTIONS.filter(
    (t) => !WORK_TYPE_BY_INSTALLATION_TYPE.has(t),
  );
}

/** 工事種別。未知の設置種別（空を含む）は null */
export function constructionWorkTypeLabel(
  installationType: string | undefined,
): string | null {
  return WORK_TYPE_BY_INSTALLATION_TYPE.get((installationType ?? "").trim()) ?? null;
}

/**
 * 施工予定日を `2026/9/5(土)` の形にする。
 *
 * 整形はタスクI（空き枠サマリ）と共通の format-weekday-date.ts に置いている。
 * ゼロ埋めしない点が formatDisplayYmd（yyyy/mm/dd）と異なる。
 */
export function formatConstructionRequestDate(raw: string | undefined): string {
  return formatYmdWithWeekday(raw);
}

const BATTERY_UNIT = "kWh";
const PANEL_UNIT = "kW";
const POWER_CON_COUNT_UNIT = "台";

/** 担当者・化粧カバーの区切り。半角カンマではなく読点 */
const IDEOGRAPHIC_COMMA = "、";

/**
 * 蓄電池容量に単位を付ける。
 * @pocket の「出力または容量」列の値に既に単位が入っている場合は二重に付けない。
 */
export function formatBatteryCapacity(raw: string | undefined): string {
  const t = (raw ?? "").trim();
  if (!t || t === "-") return "";
  // kWh / kwh / KWh などの表記ゆれを許容する
  if (/kwh/i.test(t)) return t;
  return `${t}${BATTERY_UNIT}`;
}

/**
 * 太陽光パネル容量に単位を付ける。
 *
 * @pocket の見出しは「太陽光パネル容量(kw)」と小文字だが、
 * テンプレートの表記は kW（W が大文字）に揃える。
 * 値に既に kW が入っている場合は二重に付けない。
 * 値が空のときは単位も付けない（行だけ残して値は空にする）。
 */
export function formatPanelCapacity(raw: string | undefined): string {
  const t = (raw ?? "").trim();
  if (!t || t === "-") return "";
  // kWh（蓄電池の単位）を先に弾かないと kW にマッチしてしまう
  if (/kwh/i.test(t)) return t;
  if (/kw/i.test(t)) return t;
  return `${t}${PANEL_UNIT}`;
}

/**
 * パワコン設置台数に単位を付ける。
 *
 * @pocket の選択肢は "1" / "2" で単位を含まないが、値に既に「台」が
 * 入っている場合は二重に付けない（formatBatteryCapacity と同じ流儀）。
 * 値が空のときは単位も付けない（行だけ残して値は空にする）。
 */
export function formatPowerConCount(raw: string | undefined): string {
  const t = plain(raw);
  if (!t) return "";
  if (t.endsWith(POWER_CON_COUNT_UNIT)) return t;
  return `${t}${POWER_CON_COUNT_UNIT}`;
}

/**
 * 担当者行の値。AP担当者、CL担当者 の順で読点でつなぐ。
 *
 * 同一人物なら1人分だけ出す。判定は既存の突合と同じ
 * isSameApClStaff（NFKC・空白の畳み込み）を使う。姓名の間の空白が
 * 全角と半角で違うだけの場合に別人と扱わないため、独自に trim() だけで
 * 比較してはならない（recordMatchesStaff / decideApClStaffPut と同じ判定）。
 *
 * 表示は @pocket の元の文字列。正規化するのは比較だけ。
 * 片方だけのときは読点を残さない。両方空なら空（行は残る）。
 */
export function formatConstructionRequestStaff(
  values: CustomerInfoFormValues,
): string {
  const ap = plain(values.apStaff);
  const cl = plain(values.clStaff);
  if (!ap) return cl;
  if (!cl) return ap;
  if (isSameApClStaff(values)) return ap;
  return `${ap}${IDEOGRAPHIC_COMMA}${cl}`;
}

/**
 * 化粧カバー（複数選択）を読点でつなぐ。
 *
 * 値は @pocket 取り込み時にカンマ区切りの文字列になっている
 * （checkbox-pocket.ts）。区切りの解釈は同ファイルの
 * checkboxGroupValueToPocketArray に任せ、ここでは並べ替えだけを行う。
 *
 * 並び順は COSMETIC_COVER_OPTIONS の定義順。選択した順や @pocket の
 * 返す順に左右されると、同じ内容でも案件ごとに表記が変わってしまう。
 * 定義に無い値は落とさず末尾へ回す（情報を消さないため）。
 */
export function formatCosmeticCoverLine(raw: string | undefined): string {
  const selected = checkboxGroupValueToPocketArray(plain(raw));
  if (selected.length === 0) return "";

  const options = COSMETIC_COVER_OPTIONS as readonly string[];
  const orderOf = (value: string): number => {
    const i = options.indexOf(value);
    return i === -1 ? options.length : i;
  };

  return [...selected]
    .sort((a, b) => orderOf(a) - orderOf(b))
    .join(IDEOGRAPHIC_COMMA);
}

/** ①のみ → `5.6kWh` / ①と② → `5.6kWh + 5.6kWh` */
export function formatBatteryCapacityLine(
  capacity1: string | undefined,
  capacity2: string | undefined,
): string {
  const parts = [
    formatBatteryCapacity(capacity1),
    formatBatteryCapacity(capacity2),
  ].filter(Boolean);
  return parts.join(" + ");
}

function plain(raw: string | undefined): string {
  const t = (raw ?? "").trim();
  // @pocket の「未入力」表現。テンプレートには出さない
  return t === "-" ? "" : t;
}

/** 施工予定日が未設定のときに日付の代わりに入れる */
export const CONSTRUCTION_DATE_UNDECIDED = "工事未定";

/**
 * お客様名に敬称を付ける。空のときは敬称も付けない。
 *
 * 整形は表示用の customer-name-display.ts に一本化している。
 * 空白を全角へ揃え、既に「様」が付いている値へ二重に付けない扱いも共通。
 */
export function formatCustomerNameWithHonorific(
  raw: string | undefined,
): string {
  return formatCustomerNameForDisplay(raw);
}

export type ConstructionRequestTemplateResult =
  | { ok: true; text: string; workType: string }
  /** 設置種別が未選択・未知。推測で埋めずに呼び出し側へ返す */
  | { ok: false; reason: "unknown-installation-type"; installationType: string };

/**
 * テンプレート本文を組み立てる。
 *
 * 1行目の「【…】」はメーカーと工事種別を区切らずに連結し、
 * 工事種別と施工予定日の間だけ全角スペースを入れる。
 */
export function buildConstructionRequestTemplate(
  values: CustomerInfoFormValues,
): ConstructionRequestTemplateResult {
  const installationType = plain(values.installationType);
  const workType = constructionWorkTypeLabel(installationType);
  if (!workType) {
    return {
      ok: false,
      reason: "unknown-installation-type",
      installationType,
    };
  }

  const manufacturer = plain(values.manufacturer);
  // 工事日が未設定でも【…】の中が空にならないようにする
  const scheduledDate =
    formatConstructionRequestDate(values.constructionDate) ||
    CONSTRUCTION_DATE_UNDECIDED;
  const address = `${plain(values.prefecture)}${plain(values.city)}`;

  const showPanel = !installationTypeHidesPanelSection(installationType);
  const showBattery = !installationTypeHidesBatterySection(installationType);

  const lines: string[] = [
    "⭐️新規案件依頼",
    `【${manufacturer}${workType}${IDEOGRAPHIC_SPACE}${scheduledDate}】`,
    // 担当者は前後を空行で挟んで独立させる
    "",
    `担当者：${formatConstructionRequestStaff(values)}`,
    "",
    `住所：${address}`,
    `お客様名：${formatCustomerNameWithHonorific(values.customerName)}`,
    `・メーカー：${manufacturer}`,
  ];

  if (showPanel) {
    lines.push(`・パネル：${formatPanelCapacity(values.panelCapacityKw)}`);
  }
  // パネル・蓄電池と違い、設置種別による省略はしない
  lines.push(`・パワコン設置台数：${formatPowerConCount(values.powerConCount)}`);
  if (showBattery) {
    lines.push(
      `・蓄電池：${formatBatteryCapacityLine(
        values.batteryCapacity1,
        values.batteryCapacity2,
      )}`,
    );
  }

  lines.push(
    `・屋根材：${plain(values.roofMaterial)}`,
    `・分電盤：${plain(values.breakerAmps)}`,
    `・化粧カバー：${formatCosmeticCoverLine(values.cosmeticCover)}`,
    // 空行は「・化粧カバー：」の直後。パネル行・蓄電池行が出ない設置種別でも
    // 位置が崩れないよう、条件付きの行より後ろでまとめて積む
    "",
    "📍ピンポイント",
    // URL が入る。加工しない
    plain(values.pinpointAddress),
    "",
    "ご確認よろしくお願いいたします🙇",
  );

  return { ok: true, text: lines.join("\n"), workType };
}
