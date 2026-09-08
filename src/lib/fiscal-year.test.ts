import { describe, expect, it } from "vitest";

import {
  FISCAL_ANNUAL_MONTH_KEY,
  buildFiscalMonthOptions,
  buildFiscalYearOptions,
  currentFiscalYear,
  currentYmInJst,
  fiscalYearMonths,
  fiscalYearOfYm,
  isYmInFiscalYear,
  parseFiscalMonthParam,
  parseFiscalYearParam,
} from "@/lib/fiscal-year";

/** JST 正午の UTC ミリ秒（日付境界のズレでテストが揺れないように） */
function jstNoon(year: number, month1: number, day: number): number {
  return Date.UTC(year, month1 - 1, day, 3, 0, 0);
}

describe("★ 年月がどの年度に属するか", () => {
  it("3月から翌2月までが同じ年度", () => {
    expect(fiscalYearOfYm(2026, 3)).toBe(2026);
    expect(fiscalYearOfYm(2026, 12)).toBe(2026);
    expect(fiscalYearOfYm(2027, 1)).toBe(2026);
    expect(fiscalYearOfYm(2027, 2)).toBe(2026);
  });

  it("2月と3月で年度が変わる", () => {
    expect(fiscalYearOfYm(2026, 2)).toBe(2025);
    expect(fiscalYearOfYm(2026, 3)).toBe(2026);
  });

  it("isYmInFiscalYear が年またぎを含めて判定する", () => {
    expect(isYmInFiscalYear(2026, 3, 2026)).toBe(true);
    expect(isYmInFiscalYear(2027, 2, 2026)).toBe(true);
    expect(isYmInFiscalYear(2026, 2, 2026)).toBe(false);
    expect(isYmInFiscalYear(2027, 3, 2026)).toBe(false);
  });

  it("月が範囲外なら false", () => {
    expect(isYmInFiscalYear(2026, 0, 2026)).toBe(false);
    expect(isYmInFiscalYear(2026, 13, 2026)).toBe(false);
  });
});

describe("★ 今年度（JST）", () => {
  it("3月1日は新しい年度", () => {
    expect(currentFiscalYear(jstNoon(2026, 3, 1)).startYear).toBe(2026);
  });

  it("2月末はまだ前の年度", () => {
    expect(currentFiscalYear(jstNoon(2026, 2, 28)).startYear).toBe(2025);
  });

  it("ラベルは「YYYY年度」", () => {
    expect(currentFiscalYear(jstNoon(2026, 9, 8)).label).toBe("2026年度");
    expect(currentFiscalYear(jstNoon(2026, 9, 8)).key).toBe("2026");
  });

  it("JST で判定する（UTC 2月28日15時＝JST 3月1日）", () => {
    // UTC 2026-02-28T15:00 は JST 2026-03-01T00:00
    expect(currentFiscalYear(Date.UTC(2026, 1, 28, 15, 0, 0)).startYear).toBe(
      2026,
    );
  });
});

describe("★ 年度に属する12ヶ月", () => {
  const months = fiscalYearMonths(2026);

  it("3月から翌2月まで12件", () => {
    expect(months).toHaveLength(12);
    expect(months[0]?.ym).toBe("2026-03");
    expect(months[11]?.ym).toBe("2027-02");
  });

  it("年をまたいで年が繰り上がる", () => {
    expect(months[9]).toMatchObject({ ym: "2026-12", year: 2026, month1: 12 });
    expect(months[10]).toMatchObject({ ym: "2027-01", year: 2027, month1: 1 });
    expect(months[11]).toMatchObject({ ym: "2027-02", year: 2027, month1: 2 });
  });

  it("ラベルは月だけ、順番は年度の何ヶ月目か", () => {
    expect(months[0]).toMatchObject({ label: "3月", indexInFiscalYear: 1 });
    expect(months[11]).toMatchObject({ label: "2月", indexInFiscalYear: 12 });
  });

  it("すべてその年度に属する", () => {
    for (const m of months) {
      expect(isYmInFiscalYear(m.year, m.month1, 2026)).toBe(true);
    }
  });
});

describe("★ 選べる年度は今年度・前年度の2つ", () => {
  it("先頭が今年度", () => {
    const options = buildFiscalYearOptions(jstNoon(2026, 9, 8));
    expect(options.map((o) => o.key)).toEqual(["2026", "2025"]);
  });

  it("2月に見ると前の年度が今年度になる", () => {
    const options = buildFiscalYearOptions(jstNoon(2026, 2, 10));
    expect(options.map((o) => o.key)).toEqual(["2025", "2024"]);
  });
});

describe("★ 年度パラメータの検証（allowlist）", () => {
  const now = jstNoon(2026, 9, 8);

  it("今年度・前年度は通す", () => {
    expect(parseFiscalYearParam("2026", now).startYear).toBe(2026);
    expect(parseFiscalYearParam("2025", now).startYear).toBe(2025);
  });

  it("それ以外は今年度へ落とす", () => {
    expect(parseFiscalYearParam("2024", now).startYear).toBe(2026);
    expect(parseFiscalYearParam("2027", now).startYear).toBe(2026);
    expect(parseFiscalYearParam("abc", now).startYear).toBe(2026);
    expect(parseFiscalYearParam("", now).startYear).toBe(2026);
    expect(parseFiscalYearParam(null, now).startYear).toBe(2026);
    expect(parseFiscalYearParam(undefined, now).startYear).toBe(2026);
  });
});

describe("★ 月の選択肢", () => {
  it("12ヶ月＋年間の13件", () => {
    const options = buildFiscalMonthOptions(2026);
    expect(options).toHaveLength(13);
    expect(options[0]).toEqual({ key: "2026-03", label: "3月" });
    expect(options[12]).toEqual({ key: FISCAL_ANNUAL_MONTH_KEY, label: "年間" });
  });
});

describe("★ 月パラメータの検証（allowlist）", () => {
  const now = jstNoon(2026, 9, 8);

  it("年度に属する月は通す", () => {
    expect(parseFiscalMonthParam("2026-05", 2026, now)).toEqual({
      kind: "month",
      ym: "2026-05",
      year: 2026,
      month1: 5,
      label: "2026年5月",
    });
  });

  it("年をまたいだ月も通す", () => {
    expect(parseFiscalMonthParam("2027-02", 2026, now)).toMatchObject({
      kind: "month",
      ym: "2027-02",
    });
  });

  it("annual は年間になる", () => {
    expect(parseFiscalMonthParam("annual", 2026, now)).toEqual({
      kind: "annual",
      ym: "annual",
      label: "年間",
    });
  });

  it("年度の外の月は年間へ落とす", () => {
    expect(parseFiscalMonthParam("2026-02", 2026, now).kind).toBe("annual");
    expect(parseFiscalMonthParam("2027-03", 2026, now).kind).toBe("annual");
  });

  it("不正な値は年間へ落とす", () => {
    expect(parseFiscalMonthParam("2026-13", 2026, now).kind).toBe("annual");
    expect(parseFiscalMonthParam("abc", 2026, now).kind).toBe("annual");
    expect(parseFiscalMonthParam("../../etc", 2026, now).kind).toBe("annual");
  });

  it("未指定なら今年度は当月", () => {
    expect(parseFiscalMonthParam(null, 2026, now)).toMatchObject({
      kind: "month",
      ym: "2026-09",
    });
  });

  it("未指定なら過去の年度は年間", () => {
    expect(parseFiscalMonthParam(null, 2025, now).kind).toBe("annual");
  });
});

describe("★ JST の現在の年月", () => {
  it("YYYY-MM を返す", () => {
    expect(currentYmInJst(jstNoon(2026, 9, 8))).toBe("2026-09");
  });

  it("UTC 2月28日15時は JST 3月", () => {
    expect(currentYmInJst(Date.UTC(2026, 1, 28, 15, 0, 0))).toBe("2026-03");
  });
});
