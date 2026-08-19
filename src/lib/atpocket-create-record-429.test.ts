import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRecord,
  isPocketApiRateLimited,
  isPocketHttpRateLimitError,
  markPocketApiRateLimited,
  pocketRetryAfterMsFromError,
} from "@/lib/atpocket";

/**
 * タスクT-2: 監査ログの再試行が、既存のレート制限機構と二重にブロックしないこと。
 *
 * createRecord は fetchWithMethodOverrideWithRetry を通らないので
 * isPocketApiRateLimited による合成429（実リクエストを出さずに429を返す）
 * の対象外である。ここではその前提が崩れていないことを固定する。
 * 崩れると「待ってもリクエストが飛ばず、無駄にループするだけ」になる。
 */

const AUTH = { apiKey: "audit-key-for-test" };

let fetchCalls = 0;
let nextResponse: () => Response;

beforeEach(() => {
  process.env.ATPOCKET_DOMAIN = "example.test";
  fetchCalls = 0;
  nextResponse = () => new Response("{}", { status: 200 });
  vi.stubGlobal("fetch", async () => {
    fetchCalls++;
    return nextResponse();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createRecord の 429", () => {
  it("Retry-After（秒）をエラーに載せる", async () => {
    nextResponse = () =>
      new Response("Too Many Request", {
        status: 429,
        headers: { "Retry-After": "7" },
      });

    const err = await createRecord("12", { a: 1 }, AUTH).catch((e) => e);

    expect(isPocketHttpRateLimitError(err)).toBe(true);
    expect(pocketRetryAfterMsFromError(err)).toBe(7_000);
    // メッセージの形は変えない（既存の文言判定が見ている）
    expect((err as Error).message).toContain("@pocket create record failed:");
    expect((err as Error).message).toContain("429");
  });

  it("Retry-After が HTTP-date でもミリ秒に直す", async () => {
    const when = new Date(Date.now() + 5_000).toUTCString();
    nextResponse = () =>
      new Response("Too Many Request", {
        status: 429,
        headers: { "Retry-After": when },
      });

    const err = await createRecord("12", { a: 1 }, AUTH).catch((e) => e);
    const ms = pocketRetryAfterMsFromError(err);

    expect(ms).not.toBeNull();
    expect(ms as number).toBeGreaterThan(3_000);
    expect(ms as number).toBeLessThanOrEqual(6_000);
  });

  it("Retry-After が無ければ null（呼び出し側が自前のバックオフを使う）", async () => {
    nextResponse = () => new Response("Too Many Request", { status: 429 });

    const err = await createRecord("12", { a: 1 }, AUTH).catch((e) => e);

    expect(isPocketHttpRateLimitError(err)).toBe(true);
    expect(pocketRetryAfterMsFromError(err)).toBeNull();
  });

  it("429 以外のエラーには Retry-After が付かない", async () => {
    nextResponse = () =>
      new Response("有効なフィールドではありません", { status: 400 });

    const err = await createRecord("12", { a: 1 }, AUTH).catch((e) => e);

    expect(isPocketHttpRateLimitError(err)).toBe(false);
    expect(pocketRetryAfterMsFromError(err)).toBeNull();
  });
});

describe("★ T-2: 既存のレート制限機構と二重にブロックしない", () => {
  it("markPocketApiRateLimited のあとでも createRecord は実リクエストを出す", () => {
    markPocketApiRateLimited(AUTH);
    expect(isPocketApiRateLimited(AUTH)).toBe(true);

    return createRecord("12", { a: 1 }, AUTH).then(() => {
      // 合成429で握り潰されず、実際に fetch まで届いている
      expect(fetchCalls).toBe(1);
    });
  });

  it("createRecord の 429 は markPocketApiRateLimited を呼ばない", async () => {
    const other = { apiKey: "another-key-for-test" };
    expect(isPocketApiRateLimited(other)).toBe(false);

    nextResponse = () => new Response("Too Many Request", { status: 429 });
    await createRecord("12", { a: 1 }, other).catch(() => {});

    // 書き込みの 429 で読み取り系まで 100 秒止めない
    expect(isPocketApiRateLimited(other)).toBe(false);
  });
});
