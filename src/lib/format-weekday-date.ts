/**
 * 曜日付き日付の整形（ゼロ埋めしない・曜日は日本語1文字）。
 *
 * 既存の formatDisplayYmd は yyyy/mm/dd とゼロ埋めするため、この用途には使えない。
 * タスクH（新規施工依頼テンプレート）とタスクI（空き枠サマリ）で
 * 同じ形式を使うため共通化している。
 *
 *   formatYmdWithWeekday("2026-09-05")      → "2026/9/5(土)"
 *   formatMonthDayWithWeekday("2026-09-05") → "9/5(土)"
 */

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

type YmdParts = { year: number; month: number; day: number; weekday: string };

/**
 * YYYY-MM-DD / YYYY/MM/DD を分解する。実在しない日付は null。
 *
 * 曜日はローカルタイムゾーンに影響されないよう UTC で計算する。
 * new Date("2026-09-05") は UTC 深夜として解釈されるため、
 * 負のオフセットの環境では getDay() が前日にずれる。
 */
export function parseYmdWithWeekday(raw: string | undefined): YmdParts | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const datePart =
    t.replace(/\//g, "-").split("T")[0]?.split(" ")[0]?.trim() ?? "";
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(datePart);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }

  return {
    year,
    month,
    day,
    weekday: WEEKDAY_LABELS[utc.getUTCDay()] ?? "",
  };
}

/** `2026/9/5(土)`。解釈できないときは空文字 */
export function formatYmdWithWeekday(raw: string | undefined): string {
  const p = parseYmdWithWeekday(raw);
  if (!p) return "";
  return `${p.year}/${p.month}/${p.day}(${p.weekday})`;
}

/** `9/5(土)`。年を出さない版。解釈できないときは空文字 */
export function formatMonthDayWithWeekday(raw: string | undefined): string {
  const p = parseYmdWithWeekday(raw);
  if (!p) return "";
  return `${p.month}/${p.day}(${p.weekday})`;
}
