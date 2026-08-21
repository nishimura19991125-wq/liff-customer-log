/** @pocket の顧客ステータスでキャンセルを表す値 */
export const CUSTOMER_STATUS_CANCELLED = "キャンセル";

/**
 * 「完了」とみなす顧客ステータスの**集合**。
 *
 * 1件だけの値で比較すると、選択肢が増えたときに取りこぼす。集合で持ち、
 * customer-info-form/options.test.ts で選択肢との整合を固定している。
 *
 * ■ 完工・残工を含めない理由
 * どちらも**工事の進捗**を表す値で、申請を含めた完了ではない。
 *   完工 … 工事が終わった
 *   残工 … 工事が一部残っている
 *   完了 … 申請も工事もすべて終わった  ← これだけが「完了」
 */
export const CUSTOMER_STATUS_COMPLETED_VALUES = ["完了"] as const;

function normalizeCustomerStatus(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").trim();
}

/**
 * 顧客ステータスが「完了」か。完全一致で判定する。
 *
 * キャンセル判定（isCustomerStatusCancelled）は部分一致だが、こちらは
 * 「完工」「残工」が混ざらないよう完全一致にしている。
 */
export function isCustomerStatusCompleted(
  value: string | null | undefined,
): boolean {
  const n = normalizeCustomerStatus(value);
  if (!n) return false;
  return (CUSTOMER_STATUS_COMPLETED_VALUES as readonly string[]).includes(n);
}

/**
 * 顧客ステータスがキャンセルか（@pocket の表示値・NFKC 正規化）。
 *
 * 部分一致を含む**緩い判定**。書類未回収アラートの除外や割り当て候補の
 * 除外など、「キャンセル寄りなら対象外にしておけばよい」用途で使う。
 */
export function isCustomerStatusCancelled(
  value: string | null | undefined,
): boolean {
  if (!value?.trim()) return false;
  const n = value.normalize("NFKC").trim();
  if (n === CUSTOMER_STATUS_CANCELLED) return true;
  return n.includes(CUSTOMER_STATUS_CANCELLED);
}

/**
 * キャンセル処理（タスクV）のトリガー判定。**完全一致のみ**。
 *
 * PT を 0 にし、日程・施工会社・工事対応者を消す**元に戻せない**処理なので、
 * 上の緩い判定は使わない。「キャンセル保留」のような選択肢が増えたときに、
 * 選んだだけでデータが消えるのを防ぐ。
 */
export function isCustomerStatusCancelledExact(
  value: string | null | undefined,
): boolean {
  return (
    (value ?? "").normalize("NFKC").trim() === CUSTOMER_STATUS_CANCELLED
  );
}
