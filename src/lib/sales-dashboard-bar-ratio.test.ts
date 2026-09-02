import { describe, expect, it } from "vitest";

import { barRatio } from "@/lib/sales-dashboard-bar-ratio";

describe("★ ランキング棒グラフの幅", () => {
  it("1位と同じ値なら 100", () => {
    expect(barRatio(120, 120)).toBe(100);
  });

  it("1位の半分なら 50", () => {
    expect(barRatio(60, 120)).toBe(50);
  });

  it("value が 0 なら 0", () => {
    expect(barRatio(0, 120)).toBe(0);
  });

  it("1位を超える値は 100 で頭打ち", () => {
    expect(barRatio(180, 120)).toBe(100);
  });
});

describe("★ 防御: 割合を出せない入力", () => {
  it("top が 0 なら 0（NaN を返さない）", () => {
    const r = barRatio(120, 0);
    expect(r).toBe(0);
    expect(Number.isNaN(r)).toBe(false);
  });

  it("value も top も 0 なら 0（0/0 の NaN を返さない）", () => {
    const r = barRatio(0, 0);
    expect(r).toBe(0);
    expect(Number.isNaN(r)).toBe(false);
  });

  it("top が負なら 0", () => {
    expect(barRatio(120, -10)).toBe(0);
  });

  it("value が NaN なら 0", () => {
    expect(barRatio(Number.NaN, 120)).toBe(0);
  });

  it("top が NaN なら 0", () => {
    expect(barRatio(120, Number.NaN)).toBe(0);
  });

  it("value が Infinity なら 0", () => {
    expect(barRatio(Number.POSITIVE_INFINITY, 120)).toBe(0);
  });

  it("top が Infinity なら 0", () => {
    expect(barRatio(120, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("value が -Infinity なら 0", () => {
    expect(barRatio(Number.NEGATIVE_INFINITY, 120)).toBe(0);
  });

  it("value が負なら 0（棒が反転しない）", () => {
    expect(barRatio(-30, 120)).toBe(0);
  });
});
