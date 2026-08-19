import {
  formatBatteryCapacity,
  formatPanelCapacity,
} from "@/lib/construction-request-template";
import { formatCustomerNameCompactWithHonorific } from "@/lib/customer-name-display";
import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";

/**
 * 施工会社へ送る一行サマリの組み立て（タスクU）。
 *
 * 形式:
 *   👷‍♂️<施工会社> <市区郡> <お客様名>様 <メーカー><パネル容量>kW <蓄電池容量①>kWh
 * 例:
 *   👷‍♂️ピュアライフ 尼崎市 テスト太郎様 長州産業5.775kW 7.7kWh
 *
 * ── 新規施工依頼（タスクH）との違い ─────────────────────────
 *  - お客様名は姓名の空白を**詰める**（H は全角スペースを維持）
 *  - 蓄電池は**①のみ**（H は ①＋② を「+」で連結）
 *  - 値が空の項目は**項目ごと省く**（H は行を残して空欄）
 *  - コピーしても施工依頼ステータスを更新しない
 *
 * 単位の付与は H と同じ formatPanelCapacity / formatBatteryCapacity を使う。
 * kWh は kw を含むので判定の順序が要るが、その扱いは既存関数の中にある。
 */

/** 先頭の絵文字。施工会社が空でも必ず付く（直後に市区郡が来る） */
export const CONTRACTOR_SUMMARY_PREFIX = "👷‍♂️";

/** 項目の区切り。半角スペース1つ */
const SEPARATOR = " ";

/** @pocket の「未入力」表現（"-"）は項目ごと省く */
function plain(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  return t === "-" ? "" : t;
}

/**
 * メーカーとパネル容量は区切らずに連結する（例: 長州産業5.775kW）。
 *
 * 片方だけのときは残った方をそのまま1項目として出す。
 * 2つで1つの商品表記なので、間に区切りを入れると別項目に見えてしまう。
 * 両方空なら空文字を返し、呼び出し側で項目ごと落ちる。
 */
export function buildContractorSummaryProduct(
  values: CustomerInfoFormValues,
): string {
  const manufacturer = plain(values.manufacturer);
  const capacity = formatPanelCapacity(values.panelCapacityKw);
  return `${manufacturer}${capacity}`;
}

/**
 * 一行サマリを組み立てる。
 *
 * 出せる項目が1つも無ければ空文字を返す（絵文字だけの行は出さない）。
 */
export function buildContractorSummaryLine(
  values: CustomerInfoFormValues,
): string {
  const parts = [
    plain(values.constructionContractor),
    plain(values.city),
    formatCustomerNameCompactWithHonorific(values.customerName),
    buildContractorSummaryProduct(values),
    // 蓄電池は①のみ。②は使わない
    formatBatteryCapacity(values.batteryCapacity1),
  ].filter(Boolean);

  if (parts.length === 0) return "";
  return `${CONTRACTOR_SUMMARY_PREFIX}${parts.join(SEPARATOR)}`;
}
