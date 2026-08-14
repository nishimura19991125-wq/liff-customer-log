import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchAllRecordsPages } from "@/lib/atpocket";

/**
 * ページ上限に達したまま終わったときの警告。
 *
 * 最終ページの判定は「返った件数 < 要求した1000件」なので、上限まで回りきって
 * なお満杯だった場合は続きが残っている。以前は黙って抜けていたため、
 * 件数が上限×1000 を超えた瞬間にレコードが静かに欠落した。
 */

/** ページ番号（1始まり）→ そのページが返す件数 */
let pageCounts: number[] = [];
let requestedPages: string[] = [];
/** 各レコードの中身（警告に漏れないことの確認用） */
let recordPayload: Record<string, unknown> = {};
let warnMessages: string[] = [];

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;

function jsonResponse(recordCount: number): Response {
  const records = Array.from({ length: recordCount }, (_, i) => ({
    id: String(i),
    record: { ...recordPayload },
  }));
  return new Response(JSON.stringify({ records }), { status: 200 });
}

beforeEach(() => {
  pageCounts = [];
  requestedPages = [];
  recordPayload = {};
  warnMessages = [];
  process.env.ATPOCKET_DOMAIN = "example.test";

  console.warn = (...args: unknown[]) => {
    warnMessages.push(String(args[0]));
  };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const page = new URL(String(input)).searchParams.get("page") ?? "1";
    requestedPages.push(page);
    return jsonResponse(pageCounts[Number(page) - 1] ?? 0);
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  vi.restoreAllMocks();
});

function capWarning(): string {
  return warnMessages.find((m) => m.includes("ページ上限に達した")) ?? "";
}

describe("ページ上限に達したときの警告", () => {
  it("★ 上限まで回りきって最後のページが満杯なら警告を出す", async () => {
    // 上限2ページ。両方 1000件＝続きが残っている
    pageCounts = [1000, 1000, 1000];

    const rows = await fetchAllRecordsPages(
      "58",
      "field-1",
      { apiKey: "dummy" },
      null,
      { operation: "test:page-cap", appEnv: "TEST_APP_ID" },
      { maxPages: 2 },
    );

    expect(rows).toHaveLength(2000);
    expect(requestedPages).toEqual(["1", "2"]);

    const hit = capWarning();
    expect(hit).toContain("appsId=58");
    expect(hit).toContain("maxPages=2");
    expect(hit).toContain("fetched=2000");
    expect(hit).toContain("operation=test:page-cap");
  });

  it("★ 最終ページに到達したら警告を出さない（PT 2,726件＝3ページの形）", async () => {
    pageCounts = [1000, 1000, 726];

    const rows = await fetchAllRecordsPages(
      "58",
      "field-1",
      { apiKey: "dummy" },
      null,
      { operation: "test:page-cap", appEnv: "TEST_APP_ID" },
      { maxPages: 25 },
    );

    expect(rows).toHaveLength(2726);
    expect(requestedPages).toEqual(["1", "2", "3"]);
    expect(capWarning()).toBe("");
  });

  it("0件でも警告は出さない", async () => {
    pageCounts = [0];

    const rows = await fetchAllRecordsPages("58", "field-1", {
      apiKey: "dummy",
    });

    expect(rows).toHaveLength(0);
    expect(capWarning()).toBe("");
  });

  it("上限1ページでも、そのページが満杯なら警告を出す", async () => {
    pageCounts = [1000, 1000];

    await fetchAllRecordsPages(
      "58",
      "field-1",
      { apiKey: "dummy" },
      null,
      { operation: "test:page-cap", appEnv: "TEST_APP_ID" },
      { maxPages: 1 },
    );

    expect(requestedPages).toEqual(["1"]);
    expect(capWarning()).toContain("maxPages=1");
  });

  it("★ 警告にレコードの中身・個人情報を含めない", async () => {
    pageCounts = [1000, 1000];
    recordPayload = { customerName: "山田太郎", phone: "090-1234-5678" };

    await fetchAllRecordsPages(
      "58",
      "field-1",
      { apiKey: "dummy" },
      null,
      { operation: "test:page-cap", appEnv: "TEST_APP_ID" },
      { maxPages: 2 },
    );

    const hit = capWarning();
    expect(hit).not.toContain("山田太郎");
    expect(hit).not.toContain("090-1234-5678");
    expect(hit).not.toContain("customerName");
    // JSON をそのまま貼っていないこと
    expect(hit).not.toContain("{");
  });

  it("APIキーも警告に含めない", async () => {
    pageCounts = [1000, 1000];

    await fetchAllRecordsPages(
      "58",
      "field-1",
      { apiKey: "secret-key-value" },
      null,
      { operation: "test:page-cap", appEnv: "TEST_APP_ID" },
      { maxPages: 2 },
    );

    expect(capWarning()).not.toContain("secret-key-value");
  });
});
