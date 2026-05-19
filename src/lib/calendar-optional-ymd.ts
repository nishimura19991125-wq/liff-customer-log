/** クライアント/サーバー共通: ボディ由来の任意日付 YYYY-MM-DD の検証 */

export function optionalCalendarYmd(raw: string | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== m - 1 ||
    dt.getDate() !== d
  ) {
    return null;
  }
  return s;
}
