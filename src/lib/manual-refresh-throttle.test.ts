import { beforeEach, describe, expect, it } from "vitest";

import {
  MANUAL_REFRESH_DEFAULT_INTERVAL_MS,
  resetManualRefreshThrottle,
  tryConsumeManualRefresh,
} from "@/lib/manual-refresh-throttle";

const NOW = 1_755_000_000_000;

describe("tryConsumeManualRefresh（更新ボタンの連打抑止・タスクO-2）", () => {
  beforeEach(() => {
    resetManualRefreshThrottle();
  });

  it("★ 1回目は通す（キャッシュを無視して取り直せる）", () => {
    expect(
      tryConsumeManualRefresh("sales-progress", "U1", 60_000, NOW),
    ).toEqual({ allowed: true });
  });

  it("★ 間隔内の2回目は通さず、待ち時間を返す", () => {
    tryConsumeManualRefresh("sales-progress", "U1", 60_000, NOW);
    const second = tryConsumeManualRefresh(
      "sales-progress",
      "U1",
      60_000,
      NOW + 10_000,
    );
    expect(second.allowed).toBe(false);
    expect(second.allowed === false && second.retryAfterSec).toBe(50);
  });

  it("間隔を過ぎれば再び通す", () => {
    tryConsumeManualRefresh("sales-progress", "U1", 60_000, NOW);
    expect(
      tryConsumeManualRefresh("sales-progress", "U1", 60_000, NOW + 60_000),
    ).toEqual({ allowed: true });
  });

  it("見送った回は次回の時刻を進めない（押し続けても待ち時間が伸びない）", () => {
    tryConsumeManualRefresh("sales-progress", "U1", 60_000, NOW);
    tryConsumeManualRefresh("sales-progress", "U1", 60_000, NOW + 10_000);
    tryConsumeManualRefresh("sales-progress", "U1", 60_000, NOW + 20_000);
    // 最初の1回から60秒で解ける
    expect(
      tryConsumeManualRefresh("sales-progress", "U1", 60_000, NOW + 60_000),
    ).toEqual({ allowed: true });
  });

  it("利用者ごとに独立している", () => {
    tryConsumeManualRefresh("sales-progress", "U1", 60_000, NOW);
    expect(
      tryConsumeManualRefresh("sales-progress", "U2", 60_000, NOW),
    ).toEqual({ allowed: true });
  });

  it("画面ごとに独立している", () => {
    tryConsumeManualRefresh("sales-progress", "U1", 60_000, NOW);
    expect(
      tryConsumeManualRefresh("sales-dashboard", "U1", 60_000, NOW),
    ).toEqual({ allowed: true });
  });

  it("利用者が分からないときは通す", () => {
    expect(tryConsumeManualRefresh("sales-progress", "", 60_000, NOW)).toEqual({
      allowed: true,
    });
    expect(tryConsumeManualRefresh("sales-progress", "  ", 60_000, NOW)).toEqual(
      { allowed: true },
    );
  });

  it("既定の間隔は60秒", () => {
    expect(MANUAL_REFRESH_DEFAULT_INTERVAL_MS).toBe(60_000);
    tryConsumeManualRefresh("sales-progress", "U1", undefined, NOW);
    const second = tryConsumeManualRefresh(
      "sales-progress",
      "U1",
      undefined,
      NOW + 59_000,
    );
    expect(second.allowed).toBe(false);
  });
});
