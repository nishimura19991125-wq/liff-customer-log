import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AtPocketRecordRow } from "@/lib/atpocket";

/**
 * 施工管理タブの読み取り API。
 *
 * ここで固定するのは次の4つ。
 *   - @pocket への問い合わせを増やさない（既存のキャッシュに相乗りし、
 *     工事レコードは本体カレンダーと同じ列・query で読む）
 *   - 「予定が無い」（200・空）と「取得に失敗した」（エラー）を分ける
 *   - 応答に appsId・operation・環境変数名を出さない
 *   - 名簿が引けないときは、全員「その他」にせずエラーにする
 */

const CONSTRUCTION_FIELDS = [
  { uniqueId: "field-101", caption: "お客様名" },
  { uniqueId: "field-102", caption: "施工予定日" },
  { uniqueId: "field-103", caption: "T番号" },
  { uniqueId: "field-104", caption: "施工業者" },
];

const AP = "field-ap";
const CL = "field-cl";

const h = vi.hoisted(() => ({
  auth: { ok: true, lineUserId: "U-test" } as
    | { ok: true; lineUserId: string }
    | { ok: false; reason: "no_bearer" },
  fieldsCalls: [] as string[],
  constructionCalls: [] as {
    appId: string;
    csv: string;
    query: string | null | undefined;
  }[],
  constructionRows: [] as unknown[],
  constructionError: null as Error | null,
  snapshotCalls: 0,
  snapshotError: null as Error | null,
  snapshot: { items: [] as unknown[], apFieldId: "", clFieldId: "" },
  rosterCalls: 0,
  rosterRows: [{ record: {} }] as unknown[],
  staffCfg: {
    staffAppId: "staff",
    nameFieldId: "n",
    workplaceFieldId: "w",
    companyFieldId: null,
  } as Record<string, unknown> | null,
  roster: {} as Record<string, string | null>,
  rosterWorkplaces: [] as string[],
  selfName: null as string | null,
}));

vi.mock("@/lib/request-auth", async () => {
  const { NextResponse } = await import("next/server");
  return {
    resolveCallerLineAuth: async () => h.auth,
    lineAuthUnauthorizedResponse: () =>
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
  };
});

vi.mock("@/lib/atpocket", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/atpocket")>("@/lib/atpocket");
  return {
    ...actual,
    apiKeyForCalendarPocket: () => "cal-key",
    fetchAppFields: async (appId: string) => {
      h.fieldsCalls.push(appId);
      return CONSTRUCTION_FIELDS;
    },
  };
});

vi.mock("@/lib/calendar-construction-records-cache", () => ({
  fetchCalendarConstructionRecordsCached: async (
    appId: string,
    csv: string,
    query: string | null | undefined,
  ) => {
    h.constructionCalls.push({ appId, csv, query });
    if (h.constructionError) throw h.constructionError;
    return h.constructionRows;
  },
}));

vi.mock("@/lib/customer-crm-list", () => ({
  getCachedCustomerCrmSnapshot: async () => {
    h.snapshotCalls += 1;
    if (h.snapshotError) throw h.snapshotError;
    return h.snapshot;
  },
}));

vi.mock("@/lib/customer-info-config", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/customer-info-config")
  >("@/lib/customer-info-config");
  return {
    ...actual,
    customerInfoConfigReady: () => ({ ok: true, appId: "c", nameFieldId: "n" }),
  };
});

vi.mock("@/lib/staff-roster-cache", () => ({
  fetchStaffRosterRowsCached: async () => {
    h.rosterCalls += 1;
    return h.rosterRows;
  },
}));

vi.mock("@/lib/staff-workplace-lookup", () => ({
  resolveStaffAssignmentLookupConfig: async () => h.staffCfg,
  lookupStaffAssignmentByStaffName: async (name: string) => ({
    workplace: h.roster[name] ?? null,
    company: null,
  }),
  listStaffWorkplacesInRosterOrder: async () => h.rosterWorkplaces,
}));

vi.mock("@/lib/staff-bound-lookup", () => ({
  resolveBoundStaffNameForLineUser: async () => h.selfName,
}));

const { GET } = await import("./route");
const kojo = await import("@/lib/calendar-kojo");
const { resolveConstructionMapAddressFieldIds } = await import(
  "@/lib/map-address-fields"
);

const FIDS = kojo.resolveConstructionFieldIds(
  CONSTRUCTION_FIELDS as Parameters<typeof kojo.resolveConstructionFieldIds>[0],
);

function constructionRow(id: string, start: string, t: string): AtPocketRecordRow {
  return {
    recordId: id,
    record: {
      [FIDS.title]: `工事${id}`,
      [FIDS.startDate]: start,
      [FIDS.tNumber]: t,
    },
  } as unknown as AtPocketRecordRow;
}

function customer(id: string, over: Record<string, unknown> = {}) {
  return {
    recordId: id,
    customerName: `顧客${id}`,
    subtitle: "",
    tNumber: `T-${id}`,
    isDocumentMissing: false,
    isSubsidyTarget: false,
    combinedSubsidyName: null,
    isConstructionDateUnset: false,
    isCancelled: false,
    isCompleted: false,
    housingStatus: "",
    contractorName: "",
    sortKey: 0,
    audience: { [AP]: "担当 A", [CL]: "" },
    scaffold: {
      contractor: "足場業者X",
      request: "依頼内容X",
      installDate: "2026-11-05",
      removalDate: "",
    },
    ...over,
  };
}

function req(query = "year=2026&month=11"): Request {
  return new Request(
    `http://localhost/api/calendar/construction-management?${query}`,
    { headers: { authorization: "Bearer token" } },
  );
}

const ENV_KEYS = [
  "CALENDAR_APP_ID",
  "CALENDAR_RECORDS_QUERY_FILTER",
  "API_ERROR_DETAIL",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.CALENDAR_APP_ID = "cal-app";
  delete process.env.CALENDAR_RECORDS_QUERY_FILTER;
  // テストでも本番と同じく生メッセージを出さない
  process.env.API_ERROR_DETAIL = "0";

  h.auth = { ok: true, lineUserId: "U-test" };
  h.fieldsCalls.length = 0;
  h.constructionCalls.length = 0;
  h.constructionRows = [];
  h.constructionError = null;
  h.snapshotCalls = 0;
  h.snapshotError = null;
  h.snapshot = { items: [], apFieldId: AP, clFieldId: CL };
  h.rosterCalls = 0;
  h.rosterRows = [{ record: {} }];
  h.staffCfg = {
    staffAppId: "staff",
    nameFieldId: "n",
    workplaceFieldId: "w",
    companyFieldId: null,
  };
  h.roster = { "担当 A": "支店A", "担当 B": "支店B" };
  h.rosterWorkplaces = ["支店A", "支店B"];
  h.selfName = "担当 B";
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

describe("成功", () => {
  it("★ 足場・施工予定・支店の一覧・本人の勤務場所・件数・相関IDを返す", async () => {
    h.snapshot.items = [customer("1")];
    h.constructionRows = [constructionRow("c1", "2026-11-10", "T-1")];

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.events.map((e: { kind: string }) => e.kind)).toEqual([
      "scaffoldInstall",
      "construction",
    ]);
    expect(body.counts).toEqual({
      scaffoldInstall: 1,
      scaffoldRemoval: 0,
      construction: 1,
    });
    expect(body.branches).toEqual(["支店A", "支店B"]);
    expect(body.selfWorkplace).toBe("支店B");
    expect(typeof body.correlationId).toBe("string");
    expect(body.correlationId.length).toBeGreaterThan(0);
  });

  it("★ 予定が無い月は 200 で空の一覧（エラーにしない）", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toEqual([]);
    expect(body.error).toBeUndefined();
  });

  it("★ 足場の列が未設定（値が空）でもエラーにせず、施工予定は返す", async () => {
    h.snapshot.items = [
      customer("1", {
        scaffold: { contractor: "", request: "", installDate: "", removalDate: "" },
      }),
    ];
    h.constructionRows = [constructionRow("c1", "2026-11-10", "T-1")];

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].kind).toBe("construction");
    expect(body.events[0].scaffoldContractor).toBe("");
  });

  it("ログに氏名・T番号 を出さない（件数と真偽値だけ）", async () => {
    h.snapshot.items = [customer("1")];
    h.constructionRows = [constructionRow("c1", "2026-11-10", "T-1")];
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await GET(req());

    const dumped = info.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(dumped).toContain("correlationId=");
    expect(dumped).not.toContain("担当");
    expect(dumped).not.toContain("T-1");
    expect(dumped).not.toContain("顧客");
  });
});

describe("@pocket への問い合わせ", () => {
  it("★ 既存のキャッシュをそれぞれ1回だけ読む（新しい全件取得を増やさない）", async () => {
    h.snapshot.items = [customer("1"), customer("2", { audience: { [AP]: "担当 B" } })];

    await GET(req());

    expect(h.fieldsCalls).toEqual(["cal-app"]);
    expect(h.constructionCalls).toHaveLength(1);
    expect(h.snapshotCalls).toBe(1);
    expect(h.rosterCalls).toBe(1);
  });

  it("★ 工事レコードは本体カレンダーと同じ列・同じ query で読む", async () => {
    await GET(req("year=2026&month=11"));

    // /api/calendar の route.ts と同じ組み立て
    const expectedCsv = kojo.collectConstructionFieldsCsv(
      FIDS,
      resolveConstructionMapAddressFieldIds(
        CONSTRUCTION_FIELDS as Parameters<
          typeof resolveConstructionMapAddressFieldIds
        >[0],
      ),
    );
    const expectedQuery = kojo.buildConstructionRecordsMonthOverlapQuery(
      FIDS,
      2026,
      11,
    );
    expect(h.constructionCalls[0]).toEqual({
      appId: "cal-app",
      csv: expectedCsv,
      query: expectedQuery,
    });
  });

  it("CALENDAR_RECORDS_QUERY_FILTER=false のときは本体と同じく query なし", async () => {
    process.env.CALENDAR_RECORDS_QUERY_FILTER = "false";
    await GET(req());
    expect(h.constructionCalls[0]?.query).toBeUndefined();
  });
});

describe("取得の失敗", () => {
  const RAW =
    "@pocket list records failed: 500 appsId=123 operation=calendar:工事一覧 apiKey=CALENDAR_ATPOCKET_API_KEY_1";

  function expectNoInternals(text: string) {
    expect(text).not.toContain("appsId");
    expect(text).not.toContain("operation");
    expect(text).not.toContain("CALENDAR_");
    expect(text).not.toContain("API_KEY");
    expect(text).not.toContain("@pocket");
  }

  it("★ 工事レコードの取得に失敗したら、空の結果ではなくエラーを返す", async () => {
    h.constructionError = new Error(RAW);

    const res = await GET(req());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.events).toBeUndefined();
    expect(typeof body.error).toBe("string");
    expect(typeof body.correlationId).toBe("string");
    expect(body.error).toContain(body.correlationId);
  });

  it("★ 応答に appsId・operation・環境変数名を含めない", async () => {
    h.constructionError = new Error(RAW);

    const res = await GET(req());
    expectNoInternals(await res.text());
  });

  it("★ お客様情報の取得に失敗しても、空ではなくエラー", async () => {
    h.snapshotError = new Error(RAW);

    const res = await GET(req());
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text).events).toBeUndefined();
    expectNoInternals(text);
  });

  it("利用上限（429）は 429 と Retry-After で返す", async () => {
    h.constructionError = new Error(`${RAW} 429 Too Many Requests`);

    const res = await GET(req());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");
    expectNoInternals(await res.text());
  });

  it("★ 名簿が空で返ったら（429 で古い名簿も無い）、全員「その他」にせずエラー", async () => {
    h.rosterRows = [];
    h.snapshot.items = [customer("1")];

    const res = await GET(req());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.events).toBeUndefined();
    expect(typeof body.correlationId).toBe("string");
  });

  it("名簿の勤務場所の列が無ければエラー", async () => {
    h.staffCfg = { ...h.staffCfg, workplaceFieldId: null };

    const res = await GET(req());
    expect(res.status).toBe(503);
  });

  it("工事アプリの設定が無ければ 503。環境変数名は出さない", async () => {
    delete process.env.CALENDAR_APP_ID;

    const res = await GET(req());
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toContain("CALENDAR_APP_ID");
    expect(JSON.parse(text).correlationId).toBeTruthy();
  });
});

describe("入力", () => {
  it("ログインしていなければ 401", async () => {
    h.auth = { ok: false, reason: "no_bearer" };
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it.each(["year=2026", "year=2026&month=13", "year=abc&month=1", "month=1"])(
    "年月が正しくなければ 400（%s）",
    async (q) => {
      const res = await GET(req(q));
      expect(res.status).toBe(400);
      expect(h.constructionCalls).toHaveLength(0);
    },
  );
});

describe("本人の氏名", () => {
  const EXISTING_KEYS = [
    "year",
    "month",
    "events",
    "counts",
    "branches",
    "selfWorkplace",
    "duplicateTNumberGroups",
    "correlationId",
  ];
  const EXISTING_EVENT_KEYS = [
    "id",
    "kind",
    "dayKey",
    "customerName",
    "tNumber",
    "branches",
    "scaffoldContractor",
    "scaffoldRequest",
    "constructionContractor",
    "customerMatched",
    "duplicateConstructionTNumber",
    "duplicateCustomerTNumber",
    "dates",
  ];

  it("★ 応答に本人の氏名が入る。名簿に紐づいていなければ null", async () => {
    h.selfName = "担当 B";
    expect((await (await GET(req())).json()).selfStaffName).toBe("担当 B");

    h.selfName = null;
    expect((await (await GET(req())).json()).selfStaffName).toBeNull();
  });

  it("★ 既存の項目はすべて残る（予定の項目も）", async () => {
    h.snapshot.items = [customer("1")];
    h.constructionRows = [constructionRow("c1", "2026-11-10", "T-1")];

    const body = await (await GET(req())).json();

    for (const k of EXISTING_KEYS) expect(body).toHaveProperty(k);
    expect(body.events.length).toBeGreaterThan(0);
    for (const e of body.events) {
      for (const k of EXISTING_EVENT_KEYS) expect(e).toHaveProperty(k);
      expect(Array.isArray(e.apStaffNames)).toBe(true);
      expect(Array.isArray(e.clStaffNames)).toBe(true);
    }
  });

  it("★ 問い合わせ回数は増えない", async () => {
    h.snapshot.items = [customer("1")];

    await GET(req());

    expect(h.fieldsCalls).toEqual(["cal-app"]);
    expect(h.constructionCalls).toHaveLength(1);
    expect(h.snapshotCalls).toBe(1);
    expect(h.rosterCalls).toBe(1);
  });

  it("★ サーバのログに氏名を出さない（取れたかどうかだけ）", async () => {
    h.selfName = "本人 名前";
    h.snapshot.items = [customer("1")];
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    await GET(req());

    const dumped = [info, warn, err]
      .flatMap((s) => s.mock.calls)
      .map((c) => c.map((x) => String(x)).join(" "))
      .join("\n");
    expect(dumped).not.toContain("本人");
    expect(dumped).toContain('"hasSelfStaffName":true');
  });
});
