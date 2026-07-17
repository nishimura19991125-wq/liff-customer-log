/**
 * 内部 dayKey（YYYY-MM-DD）や混在入力を、画面表示用 yyyy/mm/dd に整形する。
 * @pocket クエリ・日付比較用の内部キーは変更しない。
 */
export function formatDisplayYmd(dayKey: string): string {
  const raw = dayKey?.trim();
  if (!raw) return "";

  const datePart =
    raw.replace(/\//g, "-").split("T")[0]?.split(" ")[0]?.trim() ?? "";
  const m = datePart.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return "";

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo - 1 ||
    dt.getDate() !== d
  ) {
    return "";
  }

  return `${String(y).padStart(4, "0")}/${String(mo).padStart(2, "0")}/${String(d).padStart(2, "0")}`;
}
