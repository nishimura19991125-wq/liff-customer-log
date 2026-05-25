import "server-only";

export type SalesDashboardPeriodKey = "current" | "previous";

export type SalesDashboardPeriod = {
  key: SalesDashboardPeriodKey;
  label: string;
  hint: string;
  year: number;
  month1: number;
  startMs: number;
  endMs: number;
};

/** JST の「今月」「先月」（end は翌月1日 0:00 JST・排他的） */
export function resolveSalesDashboardPeriod(
  key: SalesDashboardPeriodKey,
): SalesDashboardPeriod {
  const d = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }),
  );
  let year = d.getFullYear();
  let month1 = d.getMonth() + 1;

  if (key === "previous") {
    if (month1 === 1) {
      year -= 1;
      month1 = 12;
    } else {
      month1 -= 1;
    }
  }

  const start = new Date(year, month1 - 1, 1, 0, 0, 0, 0);
  const end =
    month1 === 12
      ? new Date(year + 1, 0, 1, 0, 0, 0, 0)
      : new Date(year, month1, 1, 0, 0, 0, 0);

  const endInclusive = new Date(end.getTime() - 1);
  const hint = `${formatYmd(start)} ～ ${formatYmd(endInclusive)}`;

  return {
    key,
    label: `${year}年${month1}月`,
    hint,
    year,
    month1,
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

export function parseSalesDashboardPeriodParam(
  raw: string | null,
): SalesDashboardPeriodKey {
  return raw?.trim() === "previous" ? "previous" : "current";
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** レコード日付（YYYY-MM-DD 等）が対象月か（JST 暦で判定） */
export function isYmInPeriod(
  year: number,
  month1: number,
  period: SalesDashboardPeriod,
): boolean {
  return year === period.year && month1 === period.month1;
}
