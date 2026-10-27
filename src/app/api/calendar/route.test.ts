import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/calendar に残工の材料（186・契約情報入力）をつなぐ（残工 段階1）。
 *
 *   - 材料の取得に失敗しても、カレンダーは表示される（200・byDay あり）
 *   - 材料は工事レコードの取得と並べて読む（待たせない）
 *   - 失敗したことが分かる情報を月データに持つ（画面には出さない）
 *   - 186・お客様情報のアプリIDを月データのキャッシュキーに入れる
 *   - 月データのキャッシュが効いているときは材料を読みに行かない
 */

const h = vi.hoisted(() => ({
  events: [] as string[],
  sourcesCalls: 0,
  sources: null as unknown,
  sourcesThrows: false,
  /** これが解決するまで工事レコードの取得を止める */
  constructionGate: null as Promise<void> | null,
  constructionRows: [] as unknown[],
}));

const CONSTRUCTION_FIELDS = [
  { uniqueId: "field-1", caption: "お客様名" },
  { uniqueId: "field-2", caption: "施工予定日" },
  { uniqueId: "field-3", caption: "T番号" },
];

vi.mock("@/lib/request-auth", () => ({
  resolveCallerLineAuth: async () => ({ ok: true, lineUserId: "U-test" }),
  lineAuthUnauthorizedResponse: () => new Response(null, { status: 401 }),
}));

vi.mock("@/lib/atpocket", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/atpocket")>("@/lib/atpocket");
  return {
    ...actual,
    apiKeyForCalendarPocket: () => "k",
    apiKeyForCalendarReportPocket1: () => "kr",
    fetchAppFields: async () => CONSTRUCTION_FIELDS,
  };
});

vi.mock("@/lib/calendar-construction-records-cache", () => ({
  fetchCalendarConstructionRecordsCached: async () => {
    h.events.push("construction:start");
    if (h.constructionGate) await h.constructionGate;
    h.events.push("construction:end");
    return h.constructionRows;
  },
  invalidateCalendarConstructionRecordsCache: () => {},
}));

vi.mock("@/lib/calendar-report-records-cache", () => ({
  fetchCalendarReportRecordsCached: async () => [],
  invalidateCalendarReportRecordsCache: () => {},
  calendarReportRateLimitRetryAfterSec: () => 60,
}));

vi.mock("@/lib/staff-construction-handler-candidates", () => ({
  constructionHandlerStaffConfigReady: () => false,
}));

vi.mock("@/lib/zanko-calendar-sources", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/zanko-calendar-sources")
  >("@/lib/zanko-calendar-sources");
  return {
    ...actual,
    readZankoCalendarSources: async () => {
      h.sourcesCalls += 1;
      h.events.push("sources:start");
      if (h.sourcesThrows) throw new Error("想定外");
      return h.sources;
    },
  };
});

const { GET } = await import("@/app/api/calendar/route");
const { buildCalendarPayloadCacheKey, invalidateAllCalendarPayloadCache } =
  await import("@/lib/calendar-response-cache");
const { emptyZankoIndex } = await import("@/lib/zanko-index");

const ENV_KEYS = [
  "CALENDAR_APP_ID",
  "CALENDAR_REPORT_APP_ID",
  "ZANKO_APP_ID",
  "CUSTOMER_INFO_APP_ID",
  "CALENDAR_EMPTY_FILL_CONSTRUCTION_HANDLER_FIELD_ID",
  "CALENDAR_EMPTY_FILL_CONSTRUCTION_REGISTRANT_FIELD_ID",
] as const;
const savedEnv: Record<string, string | undefined> = {};

function okSources() {
  return {
    zanko: { status: "ok", index: emptyZankoIndex() },
    contract: { status: "ok", byT: new Map() },
  };
}

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.CALENDAR_APP_ID = "cal-1";
  delete process.env.CALENDAR_REPORT_APP_ID;
  process.env.ZANKO_APP_ID = "186";
  process.env.CUSTOMER_INFO_APP_ID = "ci-1";
  delete process.env.CALENDAR_EMPTY_FILL_CONSTRUCTION_HANDLER_FIELD_ID;
  delete process.env.CALENDAR_EMPTY_FILL_CONSTRUCTION_REGISTRANT_FIELD_ID;
  h.events.length = 0;
  h.sourcesCalls = 0;
  h.sources = okSources();
  h.sourcesThrows = false;
  h.constructionGate = null;
  h.constructionRows = [
    {
      recordId: 1,
      record: { "field-1": "山田 太郎", "field-2": "2026-11-05", "field-3": "T0001" },
    },
  ];
  invalidateAllCalendarPayloadCache();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function get() {
  const res = await GET(
    new Request("https://example.test/api/calendar?year=2026&month=11", {
      headers: { Authorization: "Bearer t" },
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("残工の材料の取得に失敗しても、カレンダーは表示される", () => {
  it("★ 両方 error でも 200・byDay あり", async () => {
    h.sources = {
      zanko: { status: "error", reason: "fetch_failed", index: emptyZankoIndex() },
      contract: { status: "error", reason: "rate_limited", byT: new Map() },
    };

    const { status, body } = await get();

    expect(status).toBe(200);
    const byDay = body.byDay as Record<string, unknown[]>;
    expect(byDay["2026-11-05"]).toHaveLength(1);
  });

  it("★ 部品が想定外に投げても 200（材料なしとして扱う）", async () => {
    h.sourcesThrows = true;

    const { status, body } = await get();

    expect(status).toBe(200);
    expect((body.byDay as Record<string, unknown[]>)["2026-11-05"]).toHaveLength(1);
    expect(body.zankoSourceStatus).toMatchObject({
      zanko: "error",
      contract: "error",
    });
  });

  it("★ 失敗したことが分かる情報を月データに持つ", async () => {
    h.sources = {
      zanko: { status: "error", reason: "fetch_failed", index: emptyZankoIndex() },
      contract: { status: "disabled", byT: new Map() },
    };

    const { body } = await get();

    expect(body.zankoSourceStatus).toEqual({
      zanko: "error",
      zankoReason: "fetch_failed",
      contract: "disabled",
    });
  });

  it("★ 未設定（disabled）でも 200", async () => {
    h.sources = {
      zanko: { status: "disabled", index: emptyZankoIndex() },
      contract: { status: "disabled", byT: new Map() },
    };

    const { status, body } = await get();

    expect(status).toBe(200);
    expect(body.zankoSourceStatus).toEqual({
      zanko: "disabled",
      contract: "disabled",
    });
  });
});

describe("並べて読む", () => {
  it("★ 工事レコードの取得が終わる前に、材料の取得を始めている", async () => {
    let open!: () => void;
    h.constructionGate = new Promise<void>((r) => {
      open = r;
    });

    const p = get();
    await new Promise((r) => setTimeout(r, 0));

    expect(h.events).toContain("sources:start");
    expect(h.events).not.toContain("construction:end");

    open();
    expect((await p).status).toBe(200);
  });
});

describe("月データのキャッシュ", () => {
  it("★ キャッシュが効いているときは材料を読みに行かない", async () => {
    await get();
    await get();

    expect(h.sourcesCalls).toBe(1);
  });

  it("★ キーに 186 とお客様情報のアプリIDが入る", () => {
    const base = buildCalendarPayloadCacheKey(2026, 11);

    process.env.ZANKO_APP_ID = "999";
    const zankoChanged = buildCalendarPayloadCacheKey(2026, 11);
    process.env.ZANKO_APP_ID = "186";
    process.env.CUSTOMER_INFO_APP_ID = "ci-2";
    const customerChanged = buildCalendarPayloadCacheKey(2026, 11);

    expect(zankoChanged).not.toBe(base);
    expect(customerChanged).not.toBe(base);
    expect(base).toContain("186");
    expect(base).toContain("ci-1");
  });
});
