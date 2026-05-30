/** 顧客ステータスがキャンセルか（@pocket の表示値・NFKC 正規化） */
export function isCustomerStatusCancelled(
  value: string | null | undefined,
): boolean {
  if (!value?.trim()) return false;
  const n = value.normalize("NFKC").trim();
  if (n === "キャンセル") return true;
  return n.includes("キャンセル");
}
