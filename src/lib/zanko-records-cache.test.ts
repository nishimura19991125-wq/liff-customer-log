import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 残工案件アプリ（186）の取得とキャッシュ（段階1）。
 *
 *   - ZANKO_APP_ID / ZANKO_ATPOCKET_API_KEY が無ければ「無し」（disabled）。
 *     @pocket には問い合わせず、エラーにもしない
 *   - 列は 環境変数 → 見出し（T番号・残工日）で決める
 *   - API キーは ZANKO_ATPOCKET_API_KEY だけを使う（読み取り専用）
 *   - 取得に失敗したら「残工なし」（error）。投げない
 *   - 429 のときは古い値があれば返す（stale）
 *   - キャッシュは1つ。TTL 既定600秒、ZANKO_CACHE_SECONDS（60〜7200秒）
 */

const DEFAULT_FIELDS = [
  { uniqueId: "field-2", caption: "報告内容" },
  { uniqueId: "field-3", caption: "T番号" },
  { uniqueId: "field-7", caption: "残工日" },
];

const h = vi.hoisted(() => ({
  fields: [] as { uniqueId: string; caption: string }[],
  rows: [] as unknown[],
  fieldsCalls: [] as { appId: string; apiKey?: string }[],
  listCalls: [] as {
    appId: string;
    csv: string;
    apiKey?: string;
    authKeys?: { apiKey?: string }[];
  }[],
  listError: null as Error | null,
  fieldsError: null as Error | null,
}));

vi.mock("@/lib/atpocket", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/atpocket")>("@/lib/atpocket");
  return {
    ...actual,
    fetchAppFields: async (appId: string, auth?: { apiKey?: string }) => {
      h.fieldsCalls.push({ appId, apiKey: auth?.apiKey });
      if (h.fieldsError) throw h.fieldsError;
      return h.fields;
    },
    fetchAllRecordsPages: async (
      appId: string,
      csv: string,
      auth?: { apiKey?: string },
      _query?: string | null,
      _ctx?: unknown,
      options?: { authKeys?: { apiKey?: string }[] },
    ) => {
      h.listCalls.push({
        appId,
        csv,
        apiKey: auth?.apiKey,
        authKeys: options?.authKeys,
      });
      if (h.listError) throw h.listError;
      return h.rows;
    },
  };
});

const {
  readZankoIndexCached,
  invalidateZankoRecordsCache,
  zankoCacheTtlMs,
} = await import("@/lib/zanko-records-cache");

const ENV_KEYS = [
  "ZANKO_APP_ID",
  "ZANKO_ATPOCKET_API_KEY",
  "ZANKO_TNUMBER_FIELD_ID",
  "ZANKO_DATE_FIELD_ID",
  "ZANKO_CACHE_SECONDS",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.ZANKO_APP_ID = "186";
  process.env.ZANKO_ATPOCKET_API_KEY = "zanko-read";
  delete process.env.ZANKO_TNUMBER_FIELD_ID;
  delete process.env.ZANKO_DATE_FIELD_ID;
  delete process.env.ZANKO_CACHE_SECONDS;
  h.fields = [...DEFAULT_FIELDS];
  h.rows = [{ recordId: 1, record: { "field-3": "T0001", "field-7": "2026-11-05" } }];
  h.fieldsCalls.length = 0;
  h.listCalls.length = 0;
  h.listError = null;
  h.fieldsError = null;
  invalidateZankoRecordsCache();
  vi.useRealTimers();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.useRealTimers();
});

describe("環境変数が無いとき", () => {
  it.each(["ZANKO_APP_ID", "ZANKO_ATPOCKET_API_KEY"] as const)(
    "★ %s が無ければ disabled。@pocket に問い合わせない",
    async (k) => {
      delete process.env[k];
      const r = await readZankoIndexCached();

      expect(r.status).toBe("disabled");
      expect(r.index.datesByT.size).toBe(0);
      expect(h.fieldsCalls).toEqual([]);
      expect(h.listCalls).toEqual([]);
    },
  );
});

describe("取得", () => {
  it("★ 見出し（T番号・残工日）で列を決め、2列だけ取る", async () => {
    const r = await readZankoIndexCached();

    expect(r.status).toBe("ok");
    expect(r.index.datesByT.get("T0001")).toEqual(["2026-11-05"]);
    expect(h.listCalls).toHaveLength(1);
    expect(h.listCalls[0]?.appId).toBe("186");
    expect(h.listCalls[0]?.csv.split(",").sort()).toEqual(["field-3", "field-7"]);
  });

  it("★ 環境変数で列を指定できる", async () => {
    h.fields = [
      { uniqueId: "field-3", caption: "T番号" },
      { uniqueId: "field-7", caption: "残工日" },
      { uniqueId: "field-9", caption: "管理番号" },
      { uniqueId: "field-11", caption: "予定日" },
    ];
    process.env.ZANKO_TNUMBER_FIELD_ID = "field-9";
    process.env.ZANKO_DATE_FIELD_ID = "field-11";
    h.rows = [{ recordId: 1, record: { "field-9": "T0009", "field-11": "2026-11-09" } }];

    const r = await readZankoIndexCached();

    expect(r.index.datesByT.get("T0009")).toEqual(["2026-11-09"]);
    expect(h.listCalls[0]?.csv.split(",").sort()).toEqual(["field-11", "field-9"]);
  });

  it("★ API キーは ZANKO_ATPOCKET_API_KEY だけを使う", async () => {
    await readZankoIndexCached();

    expect(h.fieldsCalls[0]?.apiKey).toBe("zanko-read");
    expect(h.listCalls[0]?.apiKey).toBe("zanko-read");
    for (const a of h.listCalls[0]?.authKeys ?? []) {
      expect(a.apiKey).toBe("zanko-read");
    }
  });

  it("★ 列が見つからなければ error（残工なし）。投げない", async () => {
    h.fields = [{ uniqueId: "field-2", caption: "報告内容" }];
    const r = await readZankoIndexCached();

    expect(r.status).toBe("error");
    expect(r.index.datesByT.size).toBe(0);
    expect(h.listCalls).toEqual([]);
  });
});

describe("失敗したとき", () => {
  it("★ 一覧の取得に失敗したら error（残工なし）。投げない", async () => {
    h.listError = new Error("@pocket list failed: 500");
    const r = await readZankoIndexCached();

    expect(r.status).toBe("error");
    expect(r.index.datesByT.size).toBe(0);
    if (r.status === "error") expect(r.reason).toBe("fetch_failed");
  });

  it("★ 列定義の取得に失敗しても error。投げない", async () => {
    h.fieldsError = new Error("@pocket fields failed: 500");
    const r = await readZankoIndexCached();
    expect(r.status).toBe("error");
  });

  it("★ 429 で古い値が無ければ error（rate_limited）", async () => {
    h.listError = new Error("@pocket 429 Too Many Requests");
    const r = await readZankoIndexCached();

    expect(r.status).toBe("error");
    if (r.status === "error") expect(r.reason).toBe("rate_limited");
  });

  it("★ 429 で古い値があれば、それを返し stale を立てる", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T10:00:00Z"));
    await readZankoIndexCached();

    vi.setSystemTime(new Date("2026-10-27T10:11:00Z")); // 600秒を過ぎた
    h.listError = new Error("@pocket 429 Too Many Requests");
    const r = await readZankoIndexCached();

    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.stale).toBe(true);
    expect(r.index.datesByT.get("T0001")).toEqual(["2026-11-05"]);
  });
});

describe("キャッシュ", () => {
  it("★ 2回呼んでも @pocket への問い合わせは1回（同時でも）", async () => {
    await Promise.all([readZankoIndexCached(), readZankoIndexCached()]);
    await readZankoIndexCached();

    expect(h.listCalls).toHaveLength(1);
  });

  it("★ TTL 既定は600秒", () => {
    expect(zankoCacheTtlMs()).toBe(600_000);
  });

  it.each([
    ["30", 60_000],
    ["1800", 1_800_000],
    ["99999", 7_200_000],
    ["abc", 600_000],
  ])("★ ZANKO_CACHE_SECONDS=%s → %d ms（60〜7200秒）", (v, ms) => {
    process.env.ZANKO_CACHE_SECONDS = v;
    expect(zankoCacheTtlMs()).toBe(ms);
  });

  it("★ TTL を過ぎたら取り直す", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T10:00:00Z"));
    await readZankoIndexCached();
    vi.setSystemTime(new Date("2026-10-27T10:09:00Z"));
    await readZankoIndexCached();
    expect(h.listCalls).toHaveLength(1);

    vi.setSystemTime(new Date("2026-10-27T10:11:00Z"));
    await readZankoIndexCached();
    expect(h.listCalls).toHaveLength(2);
  });

  it("★ アプリIDが変われば別のキャッシュ", async () => {
    await readZankoIndexCached();
    process.env.ZANKO_APP_ID = "187";
    await readZankoIndexCached();
    expect(h.listCalls.map((c) => c.appId)).toEqual(["186", "187"]);
  });
});
