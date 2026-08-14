import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 工事対応者の更新（タスクP）。
 *
 * 見たいのは書き込みの「順序」と「片方が失敗したときの返し方」なので、
 * お客様情報側の中身は customer-info-construction-handler.test.ts に任せ、
 * ここではモックして結果だけ差し替える。
 */

const h = vi.hoisted(() => ({
  /** 呼ばれた順に積む。お客様情報 → 工事カレンダー の順であること */
  order: [] as string[],
  customerInfoResult: { kind: "written", recordId: "1483" } as
    | { kind: "written"; recordId: string }
    | { kind: "skipped"; reason: string; warning: string }
    | { kind: "failed"; error: string },
  calendarShouldThrow: false,
  calendarWrites: [] as Array<Record<string, unknown>>,
  auditCalls: [] as Array<Record<string, unknown>>,
}));

const CONSTRUCTION_FIELDS = [
  { uniqueId: "field-40", caption: "工事対応者" },
  { uniqueId: "field-90", caption: "T番号" },
];

vi.mock("@/lib/request-auth", () => ({
  resolveCallerLineAuth: async () => ({ ok: true, lineUserId: "U-operator" }),
  lineAuthUnauthorizedResponse: () => new Response(null, { status: 401 }),
}));

vi.mock("@/lib/atpocket", () => ({
  apiKeyForCalendarPocket: () => "read",
  apiKeyForCalendarPocket1: () => "read1",
  apiKeyForCalendarWrite: () => "write",
  fetchAppFields: async () => CONSTRUCTION_FIELDS,
  isPocketHttpRateLimitError: () => false,
  updateRecord: async (
    _appId: string,
    _recordId: string,
    payload: Record<string, unknown>,
  ) => {
    h.order.push("calendar");
    if (h.calendarShouldThrow) throw new Error("update record failed: 502");
    h.calendarWrites.push(payload);
  },
}));

vi.mock("@/lib/customer-info-construction-handler", () => ({
  writeConstructionHandlerToCustomerInfo: async () => {
    h.order.push("customer-info");
    return h.customerInfoResult;
  },
}));

vi.mock("@/lib/calendar-construction-handler-env", () => ({
  calendarConstructionHandlerFieldIdFromEnv: () => "field-40",
}));

vi.mock("@/lib/staff-construction-handler-candidates", () => ({
  constructionHandlerStaffConfigReady: () => true,
  resolveConstructionHandlerNameForActiveStaff: async () => ({
    ok: true,
    name: "工事太郎",
  }),
}));

vi.mock("@/lib/calendar-construction-pocket-common", () => ({
  fetchConstructionRecordRow: async () => ({
    record: { "field-90": "T00001691", "field-40": "前の担当者" },
  }),
  readConstructionTNumberFromRecord: () => "T00001691",
  uniqueFieldsCsv: (...ids: string[]) => ids.filter(Boolean).join(","),
}));

vi.mock("@/lib/calendar-record-patch-server", () => ({
  buildCalendarPatchAfterConstructionSave: async () => null,
}));

vi.mock("@/lib/calendar-response-cache", () => ({
  invalidateAllCalendarPayloadCache: () => undefined,
}));

vi.mock("@/lib/audit-log", () => ({
  recordAuditLog: async (entry: Record<string, unknown>) => {
    h.auditCalls.push(entry);
    return { ok: true, written: 1 };
  },
}));

const { POST } = await import(
  "@/app/api/calendar/update-construction-handler/route"
);

function handlerRequest(): Request {
  return new Request("https://example.test/update-construction-handler", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recordId: "777",
      constructionHandlerStaffRecordId: "S-1",
    }),
  });
}

beforeEach(() => {
  h.order = [];
  h.customerInfoResult = { kind: "written", recordId: "1483" };
  h.calendarShouldThrow = false;
  h.calendarWrites = [];
  h.auditCalls = [];
  process.env.CALENDAR_APP_ID = "34";
});

describe("両方のアプリへ書き込む", () => {
  it("★ 工事対応者を変更すると、お客様情報と工事カレンダーの両方に書かれる", async () => {
    const res = await POST(handlerRequest());
    const body = (await res.json()) as { ok?: boolean; warning?: string };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.warning).toBeUndefined();
    expect(h.order).toEqual(["customer-info", "calendar"]);
    expect(h.calendarWrites[0]["field-40"]).toBe("工事太郎");
  });

  it("★ お客様情報 → 工事カレンダー の順で書く", async () => {
    await POST(handlerRequest());
    // @pocket 側に「お客様情報 → 工事カレンダー」の連携があるため、
    // 逆順だとカレンダーに書いた直後に古い値へ戻される
    expect(h.order).toEqual(["customer-info", "calendar"]);
  });

  it("★ 工事カレンダーへの更新が監査ログに残る（従来どおり）", async () => {
    await POST(handlerRequest());

    expect(h.auditCalls).toHaveLength(1);
    expect(h.auditCalls[0].targetAppId).toBe("34");
    expect(h.auditCalls[0].targetRecordId).toBe("777");
    expect(h.auditCalls[0].targetTNumber).toBe("T00001691");
  });
});

describe("片方が失敗したとき", () => {
  it("★ お客様情報への書き込みに失敗したら工事カレンダーを更新しない", async () => {
    h.customerInfoResult = { kind: "failed", error: "update record failed" };

    const res = await POST(handlerRequest());
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(502);
    expect(h.order).toEqual(["customer-info"]);
    expect(h.calendarWrites).toHaveLength(0);
    expect(body.error).toBeTruthy();
  });

  it("★ 工事カレンダーへの書き込みに失敗したら、お客様情報は反映済みと伝える", async () => {
    h.calendarShouldThrow = true;

    const res = await POST(handlerRequest());
    const body = (await res.json()) as {
      error?: string;
      customerInfoUpdated?: boolean;
    };

    expect(res.status).toBe(502);
    expect(body.customerInfoUpdated).toBe(true);
    expect(body.error).toContain("お客様情報には反映されましたが");
  });
});

describe("お客様情報のレコードが見つからないとき", () => {
  it("★ 工事カレンダーのみ更新し、警告を返す", async () => {
    h.customerInfoResult = {
      kind: "skipped",
      reason: "not-found",
      warning:
        "工事カレンダーは更新しましたが、お客様情報の該当レコードが見つかりませんでした。",
    };

    const res = await POST(handlerRequest());
    const body = (await res.json()) as { ok?: boolean; warning?: string };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.warning).toContain("該当レコードが見つかりません");
    expect(h.calendarWrites).toHaveLength(1);
  });

  it("設定が未解決のときも工事カレンダーは更新して警告を返す", async () => {
    h.customerInfoResult = {
      kind: "skipped",
      reason: "not-configured",
      warning:
        "工事カレンダーは更新しましたが、お客様情報への反映ができませんでした（設定未解決）。",
    };

    const res = await POST(handlerRequest());
    const body = (await res.json()) as { ok?: boolean; warning?: string };

    expect(res.status).toBe(200);
    expect(body.warning).toBeTruthy();
    expect(h.calendarWrites).toHaveLength(1);
  });
});
