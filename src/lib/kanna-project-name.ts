import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";

/**
 * KANNA の案件名としてコピーする1行の組み立て。
 *
 * 形式:
 *   <お客様名>様邸(<施工業者>)
 * 例:
 *   テスト　太郎様邸(◯◯建設)
 *
 * ── 既存2つのコピー機能との違い ─────────────────────────
 *  - お客様名は @pocket の値をそのまま使う（姓名の間の全角スペースを詰めない）。
 *    タイムツリー登録用は詰めるが、KANNA の案件名は @pocket の表記に合わせる
 *  - 括弧は**半角**の ( )。全角ではない
 *  - 「様邸」の直前にスペースを入れない
 *  - コピーしても @pocket は一切更新しない（タイムツリー登録用と同じ）
 */

/** 施工業者が空のときに括弧の中へ入れる */
export const KANNA_CONTRACTOR_UNDECIDED = "未定";

const HONORIFIC_SUFFIX = "様邸";

/** @pocket の「未入力」表現（"-"）は空として扱う */
function plain(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  return t === "-" ? "" : t;
}

/**
 * 案件名を組み立てる。
 *
 * お客様名が空なら**空文字**を返す。施工業者は「未定」で代用できるが、
 * お客様名が無いと案件名として成立せず、コピーしても KANNA 側で使えない。
 * 呼び出し側は空文字のときに「作成できません」の案内を出す
 * （タイムツリー登録用と同じ扱い）。
 */
export function buildKannaProjectName(values: CustomerInfoFormValues): string {
  const customerName = plain(values.customerName);
  if (!customerName) return "";

  const contractor = plain(values.constructionContractor) || KANNA_CONTRACTOR_UNDECIDED;
  return `${customerName}${HONORIFIC_SUFFIX}(${contractor})`;
}
