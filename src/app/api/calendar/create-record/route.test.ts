import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 工事カレンダーの新規登録。施工予定日の有無で経路が分かれる（第1段階）。
 *
 *   あり → 工事登録アプリに作成 → お客様情報へ連携 → T番号 を書き戻す
 *   なし → **工事登録アプリに作らない**。お客様情報にだけ作る
 *
 * 日程が決まっていない案件にまで Aki番号 を採番すると、カレンダー上に
 * 日付の無い案件が溜まる。施工予定日が空のときは工事アプリを一切触らない。
 */

const h = vi.hoisted(() => ({
  /** 工事アプリへの書き込み（作成・更新とも） */
  constructionWrites: [] as {
    recordId?: string;
    payload: Record<string, unknown>;
  }[],
  /** お客様情報連携の呼び出し */
  syncCalls: [] as Record<string, unknown>[],
  syncResult: {
    kind: "synced",
    customerInfoRecordId: "cust-1",
    tNumber: "T00003420",
  } as Record<string, unknown>,
  auditOps: [] as string[],
  fieldsFetched: 0,
}));

const CONSTRUCTION_FIELDS = [
  { uniqueId: "field-1", caption: "T番号" },
  { uniqueId: "field-101", caption: "Aki番号" },
  { uniqueId: "field-2", caption: "お客様名" },
  { uniqueId: "field-3", caption: "施工予定日" },
  { uniqueId: "field-4", caption: "施工会社" },
  { uniqueId: "field-5", caption: "住宅ステータス" },
];

vi.mock("@/lib/request-auth", () => ({
  resolveCallerLineAuth: async () => ({ ok: true, lineUserId: "U1" }),
  lineAuthUnauthorizedResponse: () =>
    new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
}));

vi.mock("@/lib/atpocket", () => ({
  apiKeyForCalendarPocket1: () => "read-key",
  apiKeyForCalendarWrite: () => "write-key",
  fetchAppFields: async () => {
    h.fieldsFetched += 1;
    return CONSTRUCTION_FIELDS;
  },
}));

vi.mock("@/lib/atpocket-write-with-import-key", () => ({
  writePocketRecordWithImportKey: async (opts: {
    recordId?: string;
    payload: Record<string, unknown>;
  }) => {
    h.constructionWrites.push({
      ...(opts.recordId ? { recordId: opts.recordId } : {}),
      payload: opts.payload,
    });
    return opts.recordId
      ? undefined
      : { recordIdHint: "con-1", row: null, location: null };
  },
}));

vi.mock("@/lib/calendar-construction-pocket-common", () => ({
  buildConstructionFillPatch: (o: Record<string, unknown>) => ({
    ...(o.resolvedImportKey
      ? { [o.resolvedImportKey as string]: o.importKeyValue ?? "" }
      : {}),
    [o.resolvedCustomer as string]: o.customerName,
  }),
  ensureConstructionImportKeyOnRecord: async () => "A0001",
  resolveConstructionRecordAfterCreate: async () => ({
    recordId: "con-1",
    uniqueKey: "A0001",
  }),
  uniqueFieldsCsv: (...ids: (string | undefined)[]) =>
    ids.filter(Boolean).join(","),
}));

vi.mock("@/lib/sync-construction-to-customer-info", () => ({
  syncConstructionRecordToCustomerInfoApp: async (
    o: Record<string, unknown>,
  ) => {
    h.syncCalls.push(o);
    return h.syncResult;
  },
}));

vi.mock("@/lib/calendar-after-construction-save", () => ({
  finalizeConstructionCalendarSave: async () =>
    new Response(JSON.stringify({ ok: true, customerInfoSynced: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
}));

vi.mock("@/lib/audit-log", () => ({
  recordAuditLog: async (e: { operation: string }) => {
    h.auditOps.push(e.operation);
    return { ok: true };
  },
}));

vi.mock("@/lib/calendar-response-cache", () => ({
  invalidateAllCalendarPayloadCache: () => {},
}));

vi.mock("@/lib/staff-construction-handler-candidates", () => ({
  constructionHandlerStaffConfigReady: () => false,
  resolveConstructionHandlerNameForActiveStaff: async () => ({
    ok: true,
    name: "",
  }),
}));

const { POST } = await import("@/app/api/calendar/create-record/route");

function post(body: Record<string, unknown>) {
  return POST(
    new Request("https://example.test/api/calendar/create-record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const BASE = { customerName: "山田 太郎", housingStatus: "既築案件" };

beforeEach(() => {
  process.env.CALENDAR_APP_ID = "app-con";
  process.env.CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID = "field-2";
  h.constructionWrites = [];
  h.syncCalls = [];
  h.auditOps = [];
  h.fieldsFetched = 0;
  h.syncResult = {
    kind: "synced",
    customerInfoRecordId: "cust-1",
    tNumber: "T00003420",
  };
});

describe("★ 施工予定日が空のとき", () => {
  it("工事登録アプリに一切書き込まない", async () => {
    const res = await post(BASE);

    expect(res.status).toBe(200);
    expect(h.constructionWrites).toHaveLength(0);
  });

  it("工事アプリの列定義も取りに行かない", async () => {
    await post(BASE);

    expect(h.fieldsFetched).toBe(0);
  });

  it("★ お客様情報にだけ作る（customerInfoOnly）", async () => {
    await post(BASE);

    expect(h.syncCalls).toHaveLength(1);
    expect(h.syncCalls[0]).toMatchObject({
      customerInfoOnly: true,
      customerName: "山田 太郎",
      housingStatus: "既築案件",
    });
  });

  it("★ 工事レコードのキーを渡さない（Aki番号 は採番されない）", async () => {
    await post(BASE);

    expect(h.syncCalls[0]).not.toHaveProperty("constructionRecordId");
    expect(h.syncCalls[0]).not.toHaveProperty("constructionImportKey");
    expect(h.syncCalls[0]).not.toHaveProperty("constructionUniqueKey");
  });

  it("施工会社は画面の入力を渡す（工事レコードから読めないため）", async () => {
    await post({ ...BASE, contractor: "ピュアライフ" });

    expect(h.syncCalls[0]).toMatchObject({ contractor: "ピュアライフ" });
  });

  it("★ カレンダーに出ないことを応答で伝える", async () => {
    const res = await post(BASE);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body).toMatchObject({
      ok: true,
      customerInfoSynced: true,
      constructionSkipped: true,
      tNumber: "T00003420",
    });
  });

  it("連携に失敗したら 502（登録できたと伝えない）", async () => {
    h.syncResult = { kind: "failed", error: "お客様情報アプリへの登録に失敗" };

    const res = await post(BASE);

    expect(res.status).toBe(502);
    expect(h.constructionWrites).toHaveLength(0);
  });

  it("お客様情報アプリが未設定なら 503", async () => {
    h.syncResult = { kind: "skipped" };

    const res = await post(BASE);

    expect(res.status).toBe(503);
  });

  it("Dropbox の警告はそのまま返す", async () => {
    h.syncResult = {
      kind: "synced",
      tNumber: "T1",
      dropboxWarning: "フォルダを用意できませんでした",
    };

    const res = await post(BASE);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.warning).toBe("フォルダを用意できませんでした");
  });
});

describe("★ 施工予定日があるとき（従来どおり・回帰）", () => {
  const WITH_DATE = { ...BASE, scheduledStartDate: "2026-12-01" };

  it("工事登録アプリに作成する", async () => {
    const res = await post(WITH_DATE);

    expect(res.status).toBe(200);
    // 作成 + T番号 書き戻し前の PUT
    expect(h.constructionWrites.length).toBeGreaterThan(0);
    expect(h.constructionWrites[0]?.recordId).toBeUndefined();
  });

  it("★ 取込キー（Aki番号）を空文字で載せる", async () => {
    await post(WITH_DATE);

    expect(h.constructionWrites[0]?.payload).toHaveProperty("field-101", "");
  });

  it("customerInfoOnly は立てない", async () => {
    await post(WITH_DATE);

    // この経路の連携は finalizeConstructionCalendarSave の中で行われる
    expect(
      h.syncCalls.some((c) => c.customerInfoOnly === true),
    ).toBe(false);
  });

  it("監査ログを記録する", async () => {
    await post(WITH_DATE);

    expect(h.auditOps).toContain("create");
  });
});

describe("入力の検証（両経路共通）", () => {
  it("お客様名が空なら 400", async () => {
    const res = await post({ ...BASE, customerName: "" });

    expect(res.status).toBe(400);
    expect(h.syncCalls).toHaveLength(0);
  });

  it("住宅ステータスが空なら 400", async () => {
    const res = await post({ ...BASE, housingStatus: "" });

    expect(res.status).toBe(400);
    expect(h.syncCalls).toHaveLength(0);
  });

  it("施工予定日の形式が違えば 400（空とは区別する）", async () => {
    const res = await post({ ...BASE, scheduledStartDate: "2026/12/01" });

    expect(res.status).toBe(400);
    expect(h.syncCalls).toHaveLength(0);
  });
});
