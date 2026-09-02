import { describe, expect, it } from "vitest";

import { achievementRate } from "@/lib/sales-dashboard-achievement";

describe("★ 達成率", () => {
  it("実績が目標と同じなら 100", () => {
    expect(achievementRate(1200, 1200)).toBe(100);
  });

  it("実績が目標の2倍なら 200（上限で丸めない）", () => {
    expect(achievementRate(2400, 1200)).toBe(200);
  });

  it("実績が目標の半分なら 50", () => {
    expect(achievementRate(600, 1200)).toBe(50);
  });

  it("実績 0 なら 0", () => {
    expect(achievementRate(0, 1200)).toBe(0);
  });

  it("小数第1位まで保持する", () => {
    // 400 / 1200 = 33.333…% → 33.3
    expect(achievementRate(400, 1200)).toBe(33.3);
    // 1642 / 1200 = 136.833…% → 136.8
    expect(achievementRate(1642, 1200)).toBe(136.8);
  });

  it("小数第2位は四捨五入する", () => {
    // 355 / 1000 = 35.5%（そのまま）
    expect(achievementRate(355, 1000)).toBe(35.5);
    // 3557 / 10000 = 35.57% → 35.6
    expect(achievementRate(3557, 10000)).toBe(35.6);
  });
});

describe("★ 防御: 達成率を出せない入力", () => {
  it("目標が 0 なら 0", () => {
    expect(achievementRate(1200, 0)).toBe(0);
  });

  it("目標が負なら 0", () => {
    expect(achievementRate(1200, -1200)).toBe(0);
  });

  it("目標が NaN なら 0", () => {
    expect(achievementRate(1200, Number.NaN)).toBe(0);
  });

  it("目標が Infinity なら 0", () => {
    expect(achievementRate(1200, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("実績が NaN なら 0", () => {
    expect(achievementRate(Number.NaN, 1200)).toBe(0);
  });

  it("実績が Infinity なら 0", () => {
    expect(achievementRate(Number.POSITIVE_INFINITY, 1200)).toBe(0);
  });

  it("実績も目標も 0 なら 0（0/0 の NaN を返さない）", () => {
    const r = achievementRate(0, 0);
    expect(r).toBe(0);
    expect(Number.isNaN(r)).toBe(false);
  });

  it("どの入力でも数値を返す（null を返さない）", () => {
    expect(typeof achievementRate(0, 0)).toBe("number");
    expect(typeof achievementRate(Number.NaN, Number.NaN)).toBe("number");
  });
});
