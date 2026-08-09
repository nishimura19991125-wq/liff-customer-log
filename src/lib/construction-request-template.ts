import {
  installationTypeHidesBatterySection,
  installationTypeHidesPanelSection,
} from "@/lib/customer-info-form/options";
import { INSTALLATION_TYPE_OPTIONS } from "@/lib/customer-info-form/schema";
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
 * 新規施工依頼の欄を出すか。
 * 施工依頼ステータスが「済」のときは、選択欄もテンプレートも出さない。
 */
export function shouldShowConstructionRequestPanel(
  constructionRequestStatus: string | undefined,
): boolean {
  return (
    (constructionRequestStatus ?? "").trim() !==
    CONSTRUCTION_REQUEST_STATUS_DONE
  );
}

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

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/**
 * 施工予定日を `2026/9/5(土)` の形にする。
 *
 * ゼロ埋めしない点が formatDisplayYmd（yyyy/mm/dd）と異なるため専用に持つ。
 * 曜日はローカルタイムゾーンに影響されないよう UTC で計算する。
 */
export function formatConstructionRequestDate(raw: string | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return "";
  const datePart =
    t.replace(/\//g, "-").split("T")[0]?.split(" ")[0]?.trim() ?? "";
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(datePart);
  if (!m) return "";

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const utc = new Date(Date.UTC(y, mo - 1, d));
  // 2026-02-30 のような実在しない日付を弾く
  if (
    utc.getUTCFullYear() !== y ||
    utc.getUTCMonth() !== mo - 1 ||
    utc.getUTCDate() !== d
  ) {
    return "";
  }

  return `${y}/${mo}/${d}(${WEEKDAY_LABELS[utc.getUTCDay()]})`;
}

const BATTERY_UNIT = "kWh";
const PANEL_UNIT = "kW";

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
  const scheduledDate = formatConstructionRequestDate(values.constructionDate);
  const address = `${plain(values.prefecture)}${plain(values.city)}`;

  const showPanel = !installationTypeHidesPanelSection(installationType);
  const showBattery = !installationTypeHidesBatterySection(installationType);

  const lines: string[] = [
    "⭐️新規案件依頼",
    `【${manufacturer}${workType}${IDEOGRAPHIC_SPACE}${scheduledDate}】`,
    `住所：${address}`,
    `お客様名：${plain(values.customerName)}`,
    `・メーカー：${manufacturer}`,
  ];

  if (showPanel) {
    lines.push(`・パネル：${formatPanelCapacity(values.panelCapacityKw)}`);
  }
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
    "📍ピンポイント",
    // URL が入る。加工しない
    plain(values.pinpointAddress),
    "ご確認よろしくお願いいたします。",
  );

  return { ok: true, text: lines.join("\n"), workType };
}
