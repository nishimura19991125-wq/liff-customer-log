/**
 * 3月始まりの年度（3月〜翌年2月）。
 *
 * 営業ランキングの期間選択が使うが、**この画面に依存しない純粋関数**として
 * 置いている。他機能からもそのまま呼べる。@pocket も環境変数も触らない。
 *
 * 年度は「その年度が始まる年」で表す。2026年度＝2026年3月〜2027年2月。
 * 現在時刻は引数で受け取る（テストのため。既定は実行時の JST）。
 */

/** 年度の始まりの月。3月 */
export const FISCAL_YEAR_START_MONTH = 3;

/** 1年度に属する月数 */
export const FISCAL_YEAR_MONTH_COUNT = 12;

/** 「年間」（その年度の累計）を表す月キー。実在の月と混ざらない値にする */
export const FISCAL_ANNUAL_MONTH_KEY = "annual";

export type FiscalYear = {
  /** 内部キー。年度が始まる年（"2026"） */
  key: string;
  /** 年度が始まる年 */
  startYear: number;
  /** 表示用（"2026年度"） */
  label: string;
};

export type FiscalMonth = {
  /** 内部キー YYYY-MM */
  ym: string;
  year: number;
  /** 1〜12 */
  month1: number;
  /** 表示用（"3月"）。年度内では年を出さない */
  label: string;
  /** 年度の何ヶ月目か（1〜12。3月が1） */
  indexInFiscalYear: number;
};

/** 月バケットの内部キー YYYY-MM。集計側と選択側で必ず同じ形にする */
export function formatYmKey(year: number, month1: number): string {
  return `${String(year).padStart(4, "0")}-${String(month1).padStart(2, "0")}`;
}

const ymOf = formatYmKey;

/** その年月が属する年度（＝年度が始まる年）。1〜2月は前年の年度 */
export function fiscalYearOfYm(year: number, month1: number): number {
  return month1 >= FISCAL_YEAR_START_MONTH ? year : year - 1;
}

export function fiscalYearLabel(startYear: number): string {
  return `${startYear}年度`;
}

function buildFiscalYear(startYear: number): FiscalYear {
  return {
    key: String(startYear),
    startYear,
    label: fiscalYearLabel(startYear),
  };
}

/** JST の「今」が属する年度 */
export function currentFiscalYear(nowMs: number = Date.now()): FiscalYear {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(nowMs));
  const year = Number(parts.find((p) => p.type === "year")?.value ?? "0");
  const month1 = Number(parts.find((p) => p.type === "month")?.value ?? "0");
  return buildFiscalYear(fiscalYearOfYm(year, month1));
}

/**
 * 年度に属する12ヶ月を3月から順に並べる。
 * 1〜2月は翌年になるので、年をまたぐ点に注意（列挙はここに閉じ込める）。
 */
export function fiscalYearMonths(startYear: number): FiscalMonth[] {
  const out: FiscalMonth[] = [];
  for (let i = 0; i < FISCAL_YEAR_MONTH_COUNT; i += 1) {
    const zeroBased = startYear * 12 + (FISCAL_YEAR_START_MONTH - 1) + i;
    const year = Math.floor(zeroBased / 12);
    const month1 = (zeroBased % 12) + 1;
    out.push({
      ym: ymOf(year, month1),
      year,
      month1,
      label: `${month1}月`,
      indexInFiscalYear: i + 1,
    });
  }
  return out;
}

/** その年月が指定の年度に属するか */
export function isYmInFiscalYear(
  year: number,
  month1: number,
  startYear: number,
): boolean {
  if (month1 < 1 || month1 > 12) return false;
  return fiscalYearOfYm(year, month1) === startYear;
}

/** 選べる年度。今年度・前年度の2つ（先頭が今年度） */
export function buildFiscalYearOptions(
  nowMs: number = Date.now(),
): FiscalYear[] {
  const current = currentFiscalYear(nowMs);
  return [current, buildFiscalYear(current.startYear - 1)];
}

/**
 * クエリの年度を選択肢の中だけで解釈する（allowlist）。
 * 今年度・前年度以外は今年度へ落とす。任意の年度を集計させない。
 */
export function parseFiscalYearParam(
  raw: string | null | undefined,
  nowMs: number = Date.now(),
): FiscalYear {
  const options = buildFiscalYearOptions(nowMs);
  const t = (raw ?? "").trim();
  return options.find((o) => o.key === t) ?? options[0]!;
}

/** 選択できる月。3月〜翌2月の12ヶ月＋「年間」 */
export function buildFiscalMonthOptions(
  startYear: number,
): Array<{ key: string; label: string }> {
  return [
    ...fiscalYearMonths(startYear).map((m) => ({ key: m.ym, label: m.label })),
    { key: FISCAL_ANNUAL_MONTH_KEY, label: "年間" },
  ];
}

/** 選択された月。year/month1 が null なら「年間」 */
export type FiscalMonthSelection =
  | { kind: "month"; ym: string; year: number; month1: number; label: string }
  | { kind: "annual"; ym: typeof FISCAL_ANNUAL_MONTH_KEY; label: string };

/**
 * クエリの月をその年度の中だけで解釈する（allowlist）。
 *
 * 年度に属さない月・不正な値は「年間」へ落とす。**年度の外の月は集計しない。**
 * 未指定は、今年度なら当月・過去の年度なら「年間」を既定にする
 * （過去の年度で当月を出しても中身が無いため）。
 */
export function parseFiscalMonthParam(
  raw: string | null | undefined,
  startYear: number,
  nowMs: number = Date.now(),
): FiscalMonthSelection {
  const months = fiscalYearMonths(startYear);
  const t = (raw ?? "").trim();

  if (t === FISCAL_ANNUAL_MONTH_KEY) return annualSelection();

  const hit = months.find((m) => m.ym === t);
  if (hit) {
    return {
      kind: "month",
      ym: hit.ym,
      year: hit.year,
      month1: hit.month1,
      label: `${hit.year}年${hit.month1}月`,
    };
  }

  if (t) return annualSelection();

  // 未指定。今年度なら当月へ寄せる
  const current = currentFiscalYear(nowMs);
  if (current.startYear !== startYear) return annualSelection();

  const nowYm = currentYmInJst(nowMs);
  const inFy = months.find((m) => m.ym === nowYm);
  if (!inFy) return annualSelection();
  return {
    kind: "month",
    ym: inFy.ym,
    year: inFy.year,
    month1: inFy.month1,
    label: `${inFy.year}年${inFy.month1}月`,
  };
}

function annualSelection(): FiscalMonthSelection {
  return { kind: "annual", ym: FISCAL_ANNUAL_MONTH_KEY, label: "年間" };
}

/** JST の現在の年月（YYYY-MM）。キャッシュの月替わり判定にも使う */
export function currentYmInJst(nowMs: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(nowMs));
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  return `${year}-${month}`;
}
