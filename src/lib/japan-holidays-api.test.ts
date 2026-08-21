import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearJapanHolidayApiCache,
  fetchJapanHolidayKeysForRange,
  fetchJapanHolidayKeysForYears,
} from "@/lib/japan-holidays-api";

/**
 * タスクV-4: 祝日は外部API（holidays-jp）から取る。
 *
 * 一番大事なのは「APIが落ちても業務が止まらない」こと。
 * 失敗したら土日のみの判定（＝祝日キーが空）に落ちる。
 */

let fetchCalls: string[] = [];
let responder: (url: string) => Promise<Response>;

beforeEach(() => {
  clearJapanHolidayApiCache();
  fetchCalls = [];
  delete process.env.CALENDAR_EXTRA_HOLIDAYS;
  delete process.env.JAPAN_HOLIDAY_API_TIMEOUT_MS;
  delete process.env.JAPAN_HOLIDAY_API_BASE_URL;
  responder = async () =>
    new Response(JSON.stringify({ "2026-01-01": "元日" }), { status: 200 });
  vi.stubGlobal("fetch", async (url: string) => {
    fetchCalls.push(String(url));
    return responder(String(url));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearJapanHolidayApiCache();
});

describe("祝日の取得", () => {
  it("年ごとのエンドポイントを叩き、日付キーだけを取り出す", async () => {
    responder = async () =>
      new Response(
        JSON.stringify({
          "2026-01-01": "元日",
          "2026-01-12": "成人の日",
          "not-a-date": "ゴミ",
        }),
        { status: 200 },
      );

    const { keys, degraded } = await fetchJapanHolidayKeysForYears([2026]);

    expect(degraded).toBe(false);
    expect([...keys].sort()).toEqual(["2026-01-01", "2026-01-12"]);
    expect(fetchCalls[0]).toContain("/2026/date.json");
  });

  it("別の年のキーが混ざっていたら捨てる", async () => {
    responder = async () =>
      new Response(
        JSON.stringify({ "2026-01-01": "元日", "2025-12-31": "誤り" }),
        { status: 200 },
      );

    const { keys } = await fetchJapanHolidayKeysForYears([2026]);

    expect([...keys]).toEqual(["2026-01-01"]);
  });

  it("★ 応答をキャッシュし、2回目は取りに行かない", async () => {
    await fetchJapanHolidayKeysForYears([2026]);
    await fetchJapanHolidayKeysForYears([2026]);
    await fetchJapanHolidayKeysForYears([2026]);

    expect(fetchCalls).toHaveLength(1);
  });

  it("年をまたぐ範囲では必要な年だけ取りに行く", async () => {
    await fetchJapanHolidayKeysForRange("2026-11-01", "2027-02-01");

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls.some((u) => u.includes("/2026/"))).toBe(true);
    expect(fetchCalls.some((u) => u.includes("/2027/"))).toBe(true);
  });
});

describe("★ APIが失敗したときのフォールバック（土日のみ判定）", () => {
  it("HTTP エラーなら祝日は空・degraded", async () => {
    responder = async () => new Response("nope", { status: 500 });

    const { keys, degraded } = await fetchJapanHolidayKeysForYears([2026]);

    expect(keys.size).toBe(0);
    expect(degraded).toBe(true);
  });

  it("通信に失敗しても投げない", async () => {
    responder = async () => {
      throw new TypeError("fetch failed");
    };

    const { keys, degraded } = await fetchJapanHolidayKeysForYears([2026]);

    expect(keys.size).toBe(0);
    expect(degraded).toBe(true);
  });

  it("★ タイムアウトしても投げず degraded になる", async () => {
    process.env.JAPAN_HOLIDAY_API_TIMEOUT_MS = "10";
    responder = (url: string) =>
      new Promise<Response>((_resolve, reject) => {
        void url;
        // AbortController が中断するまで解決しない
        setTimeout(() => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        }, 30);
      });

    const { keys, degraded } = await fetchJapanHolidayKeysForYears([2026]);

    expect(keys.size).toBe(0);
    expect(degraded).toBe(true);
  });

  it("壊れた JSON でも degraded に落ちる", async () => {
    responder = async () => new Response("<html>", { status: 200 });

    const { degraded } = await fetchJapanHolidayKeysForYears([2026]);

    expect(degraded).toBe(true);
  });

  it("一部の年だけ失敗しても、取れた年の祝日は使う", async () => {
    responder = async (url: string) => {
      if (url.includes("/2027/")) return new Response("nope", { status: 500 });
      return new Response(JSON.stringify({ "2026-01-01": "元日" }), {
        status: 200,
      });
    };

    const { keys, degraded } = await fetchJapanHolidayKeysForRange(
      "2026-11-01",
      "2027-02-01",
    );

    expect(keys.has("2026-01-01")).toBe(true);
    expect(degraded).toBe(true);
  });

  it("一度取れていれば、次に失敗しても古い内容を使う", async () => {
    await fetchJapanHolidayKeysForYears([2026]);
    // キャッシュの鮮度を切らして失敗させる
    process.env.JAPAN_HOLIDAY_API_CACHE_MS = "0";
    responder = async () => new Response("nope", { status: 500 });

    const { keys, degraded } = await fetchJapanHolidayKeysForYears([2026]);

    expect(keys.has("2026-01-01")).toBe(true);
    expect(degraded).toBe(false);
    delete process.env.JAPAN_HOLIDAY_API_CACHE_MS;
  });
});

describe("CALENDAR_EXTRA_HOLIDAYS", () => {
  it("APIが落ちていても追加分は効く", async () => {
    process.env.CALENDAR_EXTRA_HOLIDAYS = "2026-08-13,2026-08-14";
    responder = async () => new Response("nope", { status: 500 });

    const { keys, degraded } = await fetchJapanHolidayKeysForYears([2026]);

    expect(keys.has("2026-08-13")).toBe(true);
    expect(keys.has("2026-08-14")).toBe(true);
    expect(degraded).toBe(true);
  });
});
