/**
 * 営業進捗の対象月（タスクK）。
 *
 * 既存の sales-dashboard-period は "current" | "previous" の2値固定で、
 * 任意の月を選ぶこの画面では使えない。こちらは YYYY-MM をそのまま扱う。
 * 既存側は読むだけで変更していない。
 *
 * 現在時刻は引数で受け取る（テストのため。既定は実行時の JST）。
 */

/** 選択肢の件数。当月＋過去6ヶ月 */
export const SALES_PROGRESS_MONTH_OPTION_COUNT = 7;

export type SalesProgressMonth = {
  /** 内部キー YYYY-MM */
  ym: string;
  year: number;
  /** 1〜12 */
  month1: number;
  /** 表示用 2026年8月 */
  label: string;
};

function ymOf(year: number, month1: number): string {
  return `${String(year).padStart(4, "0")}-${String(month1).padStart(2, "0")}`;
}

export function formatSalesProgressMonthLabel(
  year: number,
  month1: number,
): string {
  return `${year}年${month1}月`;
}

function buildMonth(year: number, month1: number): SalesProgressMonth {
  return {
    ym: ymOf(year, month1),
    year,
    month1,
    label: formatSalesProgressMonthLabel(year, month1),
  };
}

/** JST の「今月」 */
export function currentSalesProgressMonth(
  nowMs: number = Date.now(),
): SalesProgressMonth {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(nowMs));
  const year = Number(parts.find((p) => p.type === "year")?.value ?? "0");
  const month1 = Number(parts.find((p) => p.type === "month")?.value ?? "0");
  return buildMonth(year, month1);
}

export function shiftSalesProgressMonth(
  month: SalesProgressMonth,
  deltaMonths: number,
): SalesProgressMonth {
  const zeroBased = month.year * 12 + (month.month1 - 1) + deltaMonths;
  const year = Math.floor(zeroBased / 12);
  const month1 = (zeroBased % 12) + 1;
  return buildMonth(year, month1);
}

/** 当月から過去へ並べた選択肢（先頭が当月） */
export function buildSalesProgressMonthOptions(
  nowMs: number = Date.now(),
  count: number = SALES_PROGRESS_MONTH_OPTION_COUNT,
): SalesProgressMonth[] {
  const current = currentSalesProgressMonth(nowMs);
  const n = Math.max(1, Math.floor(count));
  const out: SalesProgressMonth[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(shiftSalesProgressMonth(current, -i));
  }
  return out;
}

/**
 * クエリの month を選択肢の範囲に収めて解釈する。
 * 範囲外・不正な値は当月へ落とす（任意の月を無制限に集計させない）。
 */
export function parseSalesProgressMonthParam(
  raw: string | null | undefined,
  nowMs: number = Date.now(),
  count: number = SALES_PROGRESS_MONTH_OPTION_COUNT,
): SalesProgressMonth {
  const options = buildSalesProgressMonthOptions(nowMs, count);
  const t = (raw ?? "").trim();
  const hit = options.find((o) => o.ym === t);
  return hit ?? options[0]!;
}

/** レコードの年月が対象月か */
export function isSalesProgressMonthMatch(
  ym: { year: number; month1: number } | null,
  month: SalesProgressMonth,
): boolean {
  if (!ym) return false;
  return ym.year === month.year && ym.month1 === month.month1;
}
