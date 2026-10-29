import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 【残工】カードからの工事対応者の変更。
 *
 * 普通のカード（update-construction-handler）と同じく
 *   ① お客様情報アプリ（T番号で探す）
 *   ② 工事登録アプリ
 * の順に書く。残工カードは工事登録アプリのレコードIDを持たないので、
 * 工事登録アプリは T番号 で探し、見つかったものすべてに書く。
 */

const h = vi.hoisted(() => ({
  order: [] as string[],
  customerInfoResult: { kind: "written", recordId: "1483" } as
    | { kind: "written"; recordId: string }
    | { kind: "skipped"; reason: string; warning: string }
    | { kind: "failed"; error: string },
  customerInfoArgs: [] as Array<Record<string, unknown>>,
  found: { kind: "ok", matched: [] } as
    | {
        kind: "ok";
        matched: Array<{ recordId: string; record: Record<string, unknown> }>;
      }
    | { kind: "error"; reason: string; cause: unknown },
  searchArgs: [] as Array<Record<string, unknown>>,
  calendarWrites: [] as Array<{ recordId: string; payload: Record<string, unknown> }>,
  calendarThrowFor: null as string | null,
  auditCalls: [] as Array<Record<string, unknown>>,
  invalidated: [] as string[],
  authOk: true,
  staffReady: true,
}));

const CONSTRUCTION_FIELDS = [
  { uniqueId: "field-40", caption: "工事対応者" },
  { uniqueId: "field-90", caption: "T番号" },
  { uniqueId: "field-91", caption: "Aki番号" },
];

vi.mock("@/lib/request-auth", () => ({
  resolveCallerLineAuth: async () =>
    h.authOk ? { ok: true, lineUserId: "U-operator" } : { ok: false },
  lineAuthUnauthorizedResponse: () => new Response(null, { status: 401 }),
}));

vi.mock("@/lib/atpocket", () => ({
  apiKeyForCalendarPocket1: () => "read1",
  apiKeyForCalendarWrite: () => "write",
  fetchAppFields: async () => CONSTRUCTION_FIELDS,
  isPocketHttpRateLimitError: () => false,
  updateRecord: async (
    _appId: string,
    recordId: string,
    payload: Record<string, unknown>,
  ) => {
    h.order.push(`calendar:${recordId}`);
    if (h.calendarThrowFor === recordId) throw new Error("update failed: 502");
    h.calendarWrites.push({ recordId, payload });
  },
}));

vi.mock("@/lib/customer-info-construction-handler", () => ({
  writeConstructionHandlerToCustomerInfo: async (opts: Record<string, unknown>) => {
    h.order.push("customer-info");
    h.customerInfoArgs.push(opts);
    return h.customerInfoResult;
  },
}));

vi.mock("@/lib/customer-info-construction-link", () => ({
  listConstructionRecordsByTNumber: async (opts: Record<string, unknown>) => {
    h.order.push("search");
    h.searchArgs.push(opts);
    return h.found;
  },
}));

vi.mock("@/lib/calendar-construction-handler-env", () => ({
  calendarConstructionHandlerFieldIdFromEnv: () => "field-40",
}));

vi.mock("@/lib/staff-construction-handler-candidates", () => ({
  constructionHandlerStaffConfigReady: () => h.staffReady,
  resolveConstructionHandlerNameForActiveStaff: async () => ({
    ok: true,
    name: "工事太郎",
  }),
}));

vi.mock("@/lib/calendar-response-cache", () => ({
  invalidateAllCalendarPayloadCache: () => {
    h.invalidated.push("calendar");
  },
}));

vi.mock("@/lib/customer-crm-list", () => ({
  invalidateCustomerCrmListCache: () => {
    h.invalidated.push("customer-crm");
  },
}));

vi.mock("@/lib/audit-log", () => ({
  recordAuditLog: async (entry: Record<string, unknown>) => {
    h.auditCalls.push(entry);
    return { ok: true, written: 1 };
  },
}));

const { POST } = await import(
  "@/app/api/calendar/update-zanko-construction-handler/route"
);

function req(body: Record<string, unknown> = {}): Request {
  return new Request("https://example.test/update-zanko-construction-handler", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tNumber: "T00001691",
      constructionHandlerStaffRecordId: "S-1",
      ...body,
    }),
  });
}

function rec(recordId: string, aki: string) {
  return {
    recordId,
    record: { "field-90": "T00001691", "field-91": aki, "field-40": "前の担当者" },
  };
}

beforeEach(() => {
  h.order = [];
  h.customerInfoResult = { kind: "written", recordId: "1483" };
  h.customerInfoArgs = [];
  h.found = { kind: "ok", matched: [rec("777", "A0001")] };
  h.searchArgs = [];
  h.calendarWrites = [];
  h.calendarThrowFor = null;
  h.auditCalls = [];
  h.invalidated = [];
  h.authOk = true;
  h.staffReady = true;
  process.env.CALENDAR_APP_ID = "34";
});

describe("両方のアプリへ書く", () => {
  it("★ お客様情報アプリに書かれる（T番号・名簿の氏名）", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(h.customerInfoArgs).toEqual([
      { tNumber: "T00001691", handlerName: "工事太郎", lineUserId: "U-operator" },
    ]);
  });

  it("★ 工事登録アプリにも書かれる（T番号・取込キーを同送）", async () => {
    await POST(req());
    expect(h.calendarWrites).toEqual([
      {
        recordId: "777",
        payload: {
          "field-90": "T00001691",
          "field-40": "工事太郎",
          "field-91": "A0001",
        },
      },
    ]);
  });

  it("★ 書く順番は お客様情報 → 工事登録", async () => {
    await POST(req());
    const ci = h.order.indexOf("customer-info");
    const cal = h.order.indexOf("calendar:777");
    expect(ci).toBeGreaterThanOrEqual(0);
    expect(cal).toBeGreaterThan(ci);
  });

  it("★ 工事登録アプリは T番号 で探す", async () => {
    await POST(req());
    expect(h.searchArgs[0]).toMatchObject({
      calAppId: "34",
      tNumberFieldId: "field-90",
      tNumber: "T00001691",
    });
  });

  it("★ 探すのは書く前。探せなければどちらにも書かない", async () => {
    h.found = { kind: "error", reason: "lookup-failed", cause: new Error("429") };
    const res = await POST(req());
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(h.order).toEqual(["search"]);
  });
});

describe("工事登録アプリのレコードの数", () => {
  it("★ 無ければお客様情報だけ書いて成功。ログに残す", async () => {
    h.found = { kind: "ok", matched: [] };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await POST(req());
    const body = (await res.json()) as { ok?: boolean; warning?: string };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.warning).toBeUndefined();
    expect(h.order).toEqual(["search", "customer-info"]);
    expect(h.calendarWrites).toEqual([]);
    expect(warn.mock.calls.map((c) => c.join(" ")).join("\n")).toContain(
      "工事登録アプリ",
    );
    warn.mockRestore();
  });

  it("★ 複数あれば全部に書く（同じ値）", async () => {
    h.found = { kind: "ok", matched: [rec("777", "A0001"), rec("778", "A0002")] };
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(h.calendarWrites.map((w) => w.recordId)).toEqual(["777", "778"]);
    expect(h.calendarWrites.map((w) => w.payload["field-40"])).toEqual([
      "工事太郎",
      "工事太郎",
    ]);
    expect(h.order).toEqual(["search", "customer-info", "calendar:777", "calendar:778"]);
  });

  it("★ 1件失敗しても残りには書き、失敗を返す", async () => {
    h.found = { kind: "ok", matched: [rec("777", "A0001"), rec("778", "A0002")] };
    h.calendarThrowFor = "777";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await POST(req());
    const body = (await res.json()) as { customerInfoUpdated?: boolean };
    expect(res.status).toBe(502);
    expect(body.customerInfoUpdated).toBe(true);
    expect(h.calendarWrites.map((w) => w.recordId)).toEqual(["778"]);
  });
});

describe("普通のカードと同じ扱い", () => {
  it("★ お客様情報に書けなければ工事登録にも書かない", async () => {
    h.customerInfoResult = { kind: "failed", error: "boom" };
    const res = await POST(req());
    expect(res.status).toBe(502);
    expect(h.calendarWrites).toEqual([]);
  });

  it("★ 変更後に新しい名前が出るよう、お客様情報と工事カレンダーのキャッシュを捨てる", async () => {
    const res = await POST(req());
    const body = (await res.json()) as {
      constructionHandlerName?: string;
      tNumber?: string;
    };
    expect(h.invalidated).toEqual(
      expect.arrayContaining(["calendar", "customer-crm"]),
    );
    expect(body.constructionHandlerName).toBe("工事太郎");
    expect(body.tNumber).toBe("T00001691");
  });

  it("★ 権限：LINE の本人確認が通らなければ 401（普通のカードと同じ）", async () => {
    h.authOk = false;
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(h.order).toEqual([]);
  });

  it("★ 権限：スタッフ名簿の連携が無ければ 503（普通のカードと同じ）", async () => {
    h.staffReady = false;
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect(h.order).toEqual([]);
  });

  it("★ T番号 が無ければ 400", async () => {
    const res = await POST(req({ tNumber: "" }));
    expect(res.status).toBe(400);
    expect(h.order).toEqual([]);
  });
});
