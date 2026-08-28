import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * お客様情報のキー照合。
 *
 * 計測（A-0）で、query に**値そのもの**を渡していたため @pocket が
 * 絞り込みと解釈せず、**毎回全件を返していた**ことが確定した。
 *   queryRows 1000 / scanPages 3 / scanRows 2749 / 約2秒
 * 顧客が増えるほど遅くなり、PAGE_LIMIT × maxPages（25,000件）を超えると
 * 「見つからない」を返すようになり、**顧客レコードが二重に作られる**。
 *
 * ここで固定するのは次の4つ。
 *   - フィールド式で絞る（limit も 50 に下げる）
 *   - 絞り込みが効かなければ**全件走査へ落ちる**（黙って「無い」と言わない）
 *   - 走査は page=1 から（読み飛ばさない）
 *   - 計測は既定で無効・個人情報を出さない
 */

const KEY_FIELD = "field-268";

type Call = {
  page?: string;
  limit?: string;
  query?: string;
  fields?: string;
};

const h = vi.hoisted(() => ({
  /** page 番号 → 返す行（query 無しの走査用） */
  pages: new Map<string, unknown[]>(),
  /** 絞り込みページが返す行。null なら例外（拒否）を投げる */
  queryRows: [] as unknown[] | null,
  calls: [] as Call[],
}));

vi.mock("@/lib/customer-info-config", () => ({
  customerInfoAppId: () => "app-cust",
  customerInfoPocketAuth1: () => ({ apiKey: "k1" }),
}));

vi.mock("@/lib/atpocket", () => ({
  fetchRecordsList: async (_appId: string, params?: Call) => {
    h.calls.push({
      page: params?.page,
      limit: params?.limit,
      query: params?.query,
      fields: params?.fields,
    });
    if (params?.query) {
      if (h.queryRows === null) {
        throw new Error("@pocket list records failed: 400 invalid query");
      }
      return { records: h.queryRows };
    }
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

/** limit ぶん埋まったページ */
function fullPage(size: number, hitAt?: number): unknown[] {
  return Array.from({ length: size }, (_, i) =>
    row(`r${i}`, i === hitAt ? "T00003420" : `T9999${i}`),
  );
}

function infoCalls(): unknown[][] {
  return (console.info as unknown as { mock: { calls: unknown[][] } }).mock
    .calls;
}

function flushed(): Record<string, unknown> | null {
  const call = infoCalls()[0];
  if (!call) return null;
  expect(call[0]).toBe("[timing]");
  return JSON.parse(String(call[1])) as Record<string, unknown>;
}

function warnText(): string {
  return (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .map((c) => c.map((x) => String(x)).join(" "))
    .join("\n");
}

const queryCalls = () => h.calls.filter((c) => c.query);
const scanCalls = () => h.calls.filter((c) => !c.query);

beforeEach(() => {
  savedEnv.value = process.env.CALENDAR_TIMING_LOG;
  delete process.env.CALENDAR_TIMING_LOG;
  delete process.env.CUSTOMER_INFO_KEY_LOOKUP_MAX_PAGES;
  h.pages.clear();
  h.queryRows = [];
  h.calls.length = 0;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  if (savedEnv.value === undefined) delete process.env.CALENDAR_TIMING_LOG;
  else process.env.CALENDAR_TIMING_LOG = savedEnv.value;
  vi.restoreAllMocks();
});

describe("★ フィールド式で絞る", () => {
  it("★ query がフィールド式・limit が 50", async () => {
    h.queryRows = [row("cust-9", "T00003420")];

    const id = await findCustomerInfoRecordIdByUniqueKey(
      KEY_FIELD,
      "T00003420",
    );

    expect(id).toBe("cust-9");
    expect(queryCalls()).toHaveLength(1);
    expect(queryCalls()[0]).toMatchObject({
      page: "1",
      limit: "50",
      fields: KEY_FIELD,
      query: `${KEY_FIELD} = "T00003420"`,
    });
    // 絞り込みが効いたので全件走査はしない
    expect(scanCalls()).toHaveLength(0);
  });

  it("★ 引用符・バックスラッシュをエスケープする", async () => {
    h.queryRows = [];
    h.pages.set("1", []);

    await findCustomerInfoRecordIdByUniqueKey(KEY_FIELD, 'a"b\\c');

    expect(queryCalls()[0]?.query).toBe(`${KEY_FIELD} = "a\\"b\\\\c"`);
  });

  it("★ 絞り込みが効いて見つからなければ、走査せずに null", async () => {
    // ここで走査へ落ちると、直したはずの全件走査が残ってしまう
    h.queryRows = [];

    const id = await findCustomerInfoRecordIdByUniqueKey(
      KEY_FIELD,
      "T00003420",
    );

    expect(id).toBeNull();
    expect(scanCalls()).toHaveLength(0);
  });

  it("表記ゆれに備えて、生の値と正規化した値の2通りを試す", async () => {
    h.queryRows = [];
    h.pages.set("1", []);

    await findCustomerInfoRecordIdByUniqueKey(KEY_FIELD, "T0000  3420");

    expect(queryCalls().map((c) => c.query)).toEqual([
      `${KEY_FIELD} = "T0000  3420"`,
      `${KEY_FIELD} = "T0000 3420"`,
    ]);
  });

  it("同じ形になる値では1通りしか投げない", async () => {
    h.queryRows = [];

    await findCustomerInfoRecordIdByUniqueKey(KEY_FIELD, "T00003420");

    expect(queryCalls()).toHaveLength(1);
  });
});

describe("★ 絞り込みが効かないときは全件走査へ落ちる", () => {
  it("★ 400 で拒否されたら走査する", async () => {
    h.queryRows = null; // 例外を投げる
    h.pages.set("1", [row("cust-9", "T00003420")]);

    const id = await findCustomerInfoRecordIdByUniqueKey(
      KEY_FIELD,
      "T00003420",
    );

    expect(id).toBe("cust-9");
    expect(scanCalls()).toHaveLength(1);
  });

  it("★ 拒否されたことをログに残す（遅いまま気づかない状態を作らない）", async () => {
    h.queryRows = null;
    h.pages.set("1", []);

    await findCustomerInfoRecordIdByUniqueKey(KEY_FIELD, "T00003420");

    expect(warnText()).toContain("拒否された");
    expect(warnText()).toContain("全件走査");
  });

  it("★ 満杯で返ったら「無視された」とみなして走査する", async () => {
    // 一意キーに 50 件も一致することはない ＝ 絞り込みが効いていない
    h.queryRows = fullPage(50);
    h.pages.set("1", [row("cust-9", "T00003420")]);

    const id = await findCustomerInfoRecordIdByUniqueKey(
      KEY_FIELD,
      "T00003420",
    );

    expect(id).toBe("cust-9");
    expect(scanCalls()).toHaveLength(1);
    expect(warnText()).toContain("効いていない");
  });

  it("★ 無視されたときに「見つからない」と即断しない（顧客が二重になる）", async () => {
    h.queryRows = fullPage(50); // 目当ての値は含まれない
    h.pages.set("1", fullPage(1000));
    h.pages.set("2", [row("cust-9", "T00003420")]);

    const id = await findCustomerInfoRecordIdByUniqueKey(
      KEY_FIELD,
      "T00003420",
    );

    expect(id).toBe("cust-9");
  });

  it("★ 走査は page=1 から（先頭ページを読み飛ばさない）", async () => {
    // 絞り込みページは limit が違うので、走査の1ページ目とは中身が違う。
    // page=2 から始めると先頭 1000 件を取りこぼす
    h.queryRows = fullPage(50);
    h.pages.set("1", [row("cust-9", "T00003420")]);

    const id = await findCustomerInfoRecordIdByUniqueKey(
      KEY_FIELD,
      "T00003420",
    );

    expect(id).toBe("cust-9");
    expect(scanCalls()[0]).toMatchObject({ page: "1", limit: "1000" });
  });

  it("走査の上限まで見つからなければ null", async () => {
    process.env.CUSTOMER_INFO_KEY_LOOKUP_MAX_PAGES = "2";
    h.queryRows = null;
    for (const p of ["1", "2", "3"]) h.pages.set(p, fullPage(1000));

    const id = await findCustomerInfoRecordIdByUniqueKey(
      KEY_FIELD,
      "T00003420",
    );

    expect(id).toBeNull();
    expect(scanCalls()).toHaveLength(2);
  });
});

describe("★ 計測", () => {
  beforeEach(() => {
    process.env.CALENDAR_TIMING_LOG = "true";
  });

  it("★ 既定では何も出さない", async () => {
    delete process.env.CALENDAR_TIMING_LOG;
    h.queryRows = [row("cust-9", "T00003420")];

    await findCustomerInfoRecordIdByUniqueKey(KEY_FIELD, "T00003420");

    expect(infoCalls()).toHaveLength(0);
  });

  it("★ 絞り込みが効いていれば queryRows 1・scanPages 0", async () => {
    h.queryRows = [row("cust-9", "T00003420")];

    await findCustomerInfoRecordIdByUniqueKey(KEY_FIELD, "T00003420");

    expect(flushed()).toMatchObject({
      scope: "customer-info-key-lookup",
      mode: "query-hit",
      found: true,
      fallback: "none",
      queryRows: 1,
      scanPages: 0,
    });
  });

  it("★ 走査へ落ちた理由が残る", async () => {
    h.queryRows = fullPage(50);
    h.pages.set("1", [row("cust-9", "T00003420")]);

    await findCustomerInfoRecordIdByUniqueKey(KEY_FIELD, "T00003420");

    expect(flushed()).toMatchObject({
      mode: "scan-hit",
      fallback: "ignored",
      scanPages: 1,
    });
  });

  it("拒否されたときは fallback: failed", async () => {
    h.queryRows = null;
    h.pages.set("1", []);

    await findCustomerInfoRecordIdByUniqueKey(KEY_FIELD, "T00003420");

    expect(flushed()).toMatchObject({ fallback: "failed", mode: "scan-end" });
  });

  it("★ 探している値も、見つかったレコードIDも出さない", async () => {
    h.queryRows = [row("cust-9", "T00003420")];

    await findCustomerInfoRecordIdByUniqueKey(KEY_FIELD, "T00003420");

    const raw = String(infoCalls()[0]?.[1]);
    expect(raw).not.toContain("T00003420");
    expect(raw).not.toContain("cust-9");
  });

  it("★ 出るのは決められたキーだけ", async () => {
    h.queryRows = [row("cust-9", "T00003420")];

    await findCustomerInfoRecordIdByUniqueKey(KEY_FIELD, "T00003420");

    expect(Object.keys(flushed() ?? {}).sort()).toEqual([
      "fallback",
      "found",
      "keyField",
      "maxPages",
      "mode",
      "pageLimit",
      "queryPageLimit",
      "queryRows",
      "queryTries",
      "scanPages",
      "scanRows",
      "scope",
      "steps",
      "totalMs",
    ]);
  });
});

describe("★ 照合の結果が変わらない", () => {
  it("空のキーでは @pocket を叩かない", async () => {
    expect(await findCustomerInfoRecordIdByUniqueKey(KEY_FIELD, "   ")).toBeNull();
    expect(h.calls).toHaveLength(0);
  });

  it("全角・空白のゆれがあっても一致とみなす（照合そのものは従来どおり）", async () => {
    h.queryRows = [row("cust-9", "Ｔ00003420")];

    // 走査に落ちても同じ結果になること
    const viaQuery = await findCustomerInfoRecordIdByUniqueKey(
      KEY_FIELD,
      "Ｔ00003420",
    );
    expect(viaQuery).toBe("cust-9");
  });

  it("計測の有無で結果が変わらない", async () => {
    h.queryRows = [row("cust-9", "T00003420")];

    const off = await findCustomerInfoRecordIdByUniqueKey(
      KEY_FIELD,
      "T00003420",
    );
    process.env.CALENDAR_TIMING_LOG = "true";
    const on = await findCustomerInfoRecordIdByUniqueKey(
      KEY_FIELD,
      "T00003420",
    );

    expect(on).toBe(off);
  });
});
