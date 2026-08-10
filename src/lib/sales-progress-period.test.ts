import { describe, expect, it } from "vitest";

import {
  buildSalesProgressMonthOptions,
  currentSalesProgressMonth,
  isSalesProgressMonthMatch,
  parseSalesProgressMonthParam,
  shiftSalesProgressMonth,
} from "@/lib/sales-progress-period";

/** 2026-08-10 12:00 JST */
const NOW = Date.UTC(2026, 7, 10, 3, 0);

describe("currentSalesProgressMonth", () => {
  it("JST の当月を返す", () => {
    expect(currentSalesProgressMonth(NOW)).toMatchObject({
      ym: "2026-08",
      year: 2026,
      month1: 8,
      label: "2026年8月",
    });
  });

  it("UTC では前日でも JST の月で判定する", () => {
    // 2026-08-31 15:30 UTC = 2026-09-01 00:30 JST
    expect(currentSalesProgressMonth(Date.UTC(2026, 7, 31, 15, 30)).ym).toBe(
      "2026-09",
    );
  });
});

describe("shiftSalesProgressMonth", () => {
  it("年をまたいで戻れる", () => {
    const aug = currentSalesProgressMonth(NOW);
    expect(shiftSalesProgressMonth(aug, -8).ym).toBe("2025-12");
    expect(shiftSalesProgressMonth(aug, -12).ym).toBe("2025-08");
  });

  it("先へも動く", () => {
    const aug = currentSalesProgressMonth(NOW);
    expect(shiftSalesProgressMonth(aug, 5).ym).toBe("2027-01");
  });
});

describe("buildSalesProgressMonthOptions", () => {
  it("当月＋過去6ヶ月の7件を新しい順で返す", () => {
    const options = buildSalesProgressMonthOptions(NOW);
    expect(options).toHaveLength(7);
    expect(options.map((o) => o.ym)).toEqual([
      "2026-08",
      "2026-07",
      "2026-06",
      "2026-05",
      "2026-04",
      "2026-03",
      "2026-02",
    ]);
    expect(options[0]?.label).toBe("2026年8月");
  });

  it("年をまたぐ場合も連続する", () => {
    const options = buildSalesProgressMonthOptions(Date.UTC(2026, 1, 10, 3, 0));
    expect(options.map((o) => o.ym)).toEqual([
      "2026-02",
      "2026-01",
      "2025-12",
      "2025-11",
      "2025-10",
      "2025-09",
      "2025-08",
    ]);
  });
});

describe("parseSalesProgressMonthParam", () => {
  it("選択肢に含まれる月はそのまま使う", () => {
    expect(parseSalesProgressMonthParam("2026-05", NOW).ym).toBe("2026-05");
  });

  it("選択肢の範囲外は当月へ落とす（無制限に集計させない）", () => {
    expect(parseSalesProgressMonthParam("2025-01", NOW).ym).toBe("2026-08");
    expect(parseSalesProgressMonthParam("2027-02", NOW).ym).toBe("2026-08");
  });

  it("不正な値・未指定は当月", () => {
    expect(parseSalesProgressMonthParam(null, NOW).ym).toBe("2026-08");
    expect(parseSalesProgressMonthParam("", NOW).ym).toBe("2026-08");
    expect(parseSalesProgressMonthParam("2026-8", NOW).ym).toBe("2026-08");
    expect(parseSalesProgressMonthParam("../etc", NOW).ym).toBe("2026-08");
  });
});

describe("isSalesProgressMonthMatch", () => {
  const month = currentSalesProgressMonth(NOW);

  it("同じ年月なら true", () => {
    expect(isSalesProgressMonthMatch({ year: 2026, month1: 8 }, month)).toBe(true);
  });

  it("年か月が違えば false", () => {
    expect(isSalesProgressMonthMatch({ year: 2025, month1: 8 }, month)).toBe(false);
    expect(isSalesProgressMonthMatch({ year: 2026, month1: 7 }, month)).toBe(false);
  });

  it("日付を読めなかった行（null）は false", () => {
    expect(isSalesProgressMonthMatch(null, month)).toBe(false);
  });
});
