import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * お客様情報のキー照合の計測（A-0）。
 *
 * 実測でこの照合が1回あたり約2秒かかっていた。原因が
 *   「query が効かず1000件を運んでいる」のか
 *   「@pocket の応答自体が遅い」のか
 * をコードから決められないので、行数とページ数を出せるようにした。
 *
 * ここで固定するのは次の3つ。
 *   - 既定では何も出さない
 *   - 出すのは行数・ページ数・上限値と列の識別子だけ（探している値は出さない）
 *   - **照合の結果と @pocket への投げ方が変わっていない**（計測だけ）
 */

const KEY_FIELD = "field-268";

const h = vi.hoisted(() => ({
  /** page 番号 → 返す行 */
  pages: new Map<string, unknown[]>(),
  calls: [] as Array<{ page?: string; limit?: string; query?: string }>,
}));

vi.mock("@/lib/customer-info-config", () => ({
  customerInfoAppId: () => "app-cust",
  customerInfoPocketAuth1: () => ({ apiKey: "k1" }),
}));

vi.mock("@/lib/atpocket", () => ({
  fetchRecordsList: async (
    _appId: string,
    params?: { page?: string; limit?: string; query?: string },
  ) => {
    h.calls.push({
      page: params?.page,
      limit: params?.limit,
      query: params?.query,
    });
    return { records: h.pages.get(params?.page ?? "1") ?? [] };
  },
}));

const { findCustomerInfoRecordIdByUniqueKey } = await import(
  "@/lib/customer-info-key-lookup"
);

const savedEnv = { value: undefined as string | undefined };

function row(recordId: string, tNumber: string) {
  return { recordId, record: { [KEY_FIELD]: tNumber } };
}

/** 1000件（PAGE_LIMIT）の満杯ページ。1件だけ目当ての値を混ぜられる */
function fullPage(hitAt?: number): unknown[] {
  return Array.from({ length: 1000 }, (_, i) =>
    row(`r${i}`, i === hitAt ? "T00003420" : `T9999${i}`),
  );
}

function flushed(): Record<string, unknown> | null {
  const call = (console.info as unknown as { mock: { calls: unknown[][] } })
    .mock.calls[0];
  if (!call) return null;
  expect(call[0]).toBe("[timing]");
  return JSON.parse(String(call[1])) as Record<string, unknown>;
}

beforeEach(() => {
  savedEnv.value = process.env.CALENDAR_TIMING_LOG;
  delete process.env.CALENDAR_TIMING_LOG;
  h.pages.clear();
  h.calls.length = 0;
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  if (savedEnv.value === undefined) delete process.env.CALENDAR_TIMING_LOG;
  else process.env.CALENDAR_TIMING_LOG = savedEnv.value;
  vi.restoreAllMocks();
});

describe("★ 計測は既定で無効", () => {
  it("★ 何も出さない", async () => {
    h.pages.set("1", [row("cust-9", "T00003420")]);

    await findCustomerInfoRecordIdByUniqueKey(KEY_FIELD, "T00003420");

    expect(console.info).not.toHaveBeenCalled();
  });
});

describe("★ 何が返っているかを出す", () => {
  beforeEach(() => {
    process.env.CALENDAR_TIMING_LOG = "true";
  });

  it("★ query 付きの1ページ目で見つかったら query-hit と行数", async () => {
    h.pages.set("1", [row("cust-9", "T00003420")]);

    const id = await findCustomerInfoRecordIdByUniqueKey(
      KEY_FIELD,
      "T00003420",
    );

    expect(id).toBe("cust-9");
    expect(flushed()).toMatchObject({
      scope: "customer-info-key-lookup",
      mode: "query-hit",
      found: true,
      queryRows: 1,
      scanPages: 0,
      pageLimit: 1000,
    });
  });

  it("★ query が効いていなければ行数が pageLimit に張り付く", async () => {
    // これが出たら「値そのものを query に渡していて絞れていない」の裏付け
    h.pages.set("1", fullPage(500));

    const id = await findCustomerInfoRecordIdByUniqueKey(
      KEY_FIELD,
      "T00003420",
    );

    expect(id).toBe("r500");
    expect(flushed()).toMatchObject({
      mode: "query-hit",
      queryRows: 1000,
      pageLimit: 1000,
    });
  });

  it("★ 全件走査に落ちたらページ数と合計行数が出る（緊急の判別）", async () => {
    // 1ページ目が満杯で当たらない → query 無しのページ走査へ落ちる
    h.pages.set("1", fullPage());
    h.pages.set("2", [row("cust-9", "T00003420")]);

    const id = await findCustomerInfoRecordIdByUniqueKey(
      KEY_FIELD,
      "T00003420",
    );

    expect(id).toBe("cust-9");
    const out = flushed();
    expect(out).toMatchObject({ mode: "scan-hit", found: true });
    // query 付き1回 + 走査2ページ
    expect(out?.scanPages).toBe(2);
    expect(out?.scanRows).toBe(1001);
  });

  it("見つからなければ query-end と found: false", async () => {
    h.pages.set("1", [row("cust-1", "T00000001")]);

    const id = await findCustomerInfoRecordIdByUniqueKey(
      KEY_FIELD,
      "T00003420",
    );

    expect(id).toBeNull();
    expect(flushed()).toMatchObject({ mode: "query-end", found: false });
  });

  it("上限ページまで舐めても見つからなければ scan-cap", async () => {
    process.env.CUSTOMER_INFO_KEY_LOOKUP_MAX_PAGES = "2";
    // どのページも満杯で当たらない
    for (const p of ["1", "2", "3"]) h.pages.set(p, fullPage());

    const id = await findCustomerInfoRecordIdByUniqueKey(
      KEY_FIELD,
      "T00003420",
    );

    expect(id).toBeNull();
    expect(flushed()).toMatchObject({ mode: "scan-cap", maxPages: 2 });
    delete process.env.CUSTOMER_INFO_KEY_LOOKUP_MAX_PAGES;
  });
});

describe("★ 個人情報を出さない", () => {
  beforeEach(() => {
    process.env.CALENDAR_TIMING_LOG = "true";
  });

  it("★ 探している値も、見つかったレコードIDも出さない", async () => {
    h.pages.set("1", [row("cust-9", "T00003420")]);

    await findCustomerInfoRecordIdByUniqueKey(KEY_FIELD, "T00003420");

    const raw = String(
      (console.info as unknown as { mock: { calls: unknown[][] } }).mock
        .calls[0]?.[1],
    );
    expect(raw).not.toContain("T00003420");
    expect(raw).not.toContain("cust-9");
  });

  it("★ 出るのは決められたキーだけ", async () => {
    h.pages.set("1", [row("cust-9", "T00003420")]);

    await findCustomerInfoRecordIdByUniqueKey(KEY_FIELD, "T00003420");

    expect(Object.keys(flushed() ?? {}).sort()).toEqual([
      "found",
      "keyField",
      "maxPages",
      "mode",
      "pageLimit",
      "queryRows",
      "scanPages",
      "scanRows",
      "scope",
      "steps",
      "totalMs",
    ]);
  });
});

describe("★ 照合の挙動を変えていない（計測だけ）", () => {
  it("★ @pocket への投げ方が同じ（limit・query・fields）", async () => {
    process.env.CALENDAR_TIMING_LOG = "true";
    h.pages.set("1", [row("cust-9", "T00003420")]);

    await findCustomerInfoRecordIdByUniqueKey(KEY_FIELD, "T00003420");

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({
      page: "1",
      limit: "1000",
      // まだフィールド式にしていない（A-0 は計測のみ）
      query: "T00003420",
    });
  });

  it("★ 計測が無効でも有効でも、返る値と呼び出し回数が同じ", async () => {
    h.pages.set("1", fullPage());
    h.pages.set("2", [row("cust-9", "T00003420")]);

    const off = await findCustomerInfoRecordIdByUniqueKey(
      KEY_FIELD,
      "T00003420",
    );
    const callsOff = h.calls.length;

    h.calls.length = 0;
    process.env.CALENDAR_TIMING_LOG = "true";
    const on = await findCustomerInfoRecordIdByUniqueKey(
      KEY_FIELD,
      "T00003420",
    );

    expect(on).toBe(off);
    expect(h.calls).toHaveLength(callsOff);
  });
});
