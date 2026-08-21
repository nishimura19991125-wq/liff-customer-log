/** @pocket の顧客ステータスでキャンセルを表す値 */
export const CUSTOMER_STATUS_CANCELLED = "キャンセル";

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
