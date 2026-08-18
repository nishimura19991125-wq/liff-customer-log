import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * タスクS-3: 「空き枠を使わずに登録する」経路。
 *
 * ここで一番大事なのは**空き枠を削除しないこと**。空き枠の削除は
 * assign-case-to-slot だけの仕事で、削除経路を増やさない。
 */

const h = vi.hoisted(() => ({
  /** @pocket の物理削除。1回でも呼ばれたら設計違反 */
  deleteCalls: [] as string[],
  writes: [] as Array<{ recordId: string; payload: Record<string, unknown> }>,
  auditOps: [] as string[],
  cancelled: false,
  caseRecord: {} as Record<string, unknown>,
}));

const APP_FIELDS = [
  { uniqueId: "field-1", caption: "T番号" },
  { uniqueId: "field-2", caption: "お客様名" },
  { uniqueId: "field-3", caption: "施工予定日" },
  { uniqueId: "field-4", caption: "施工会社" },
  { uniqueId: "field-5", caption: "住宅ステータス" },
];

vi.mock("@/lib/request-auth", () => ({
  resolveCallerLineAuth: async () => ({ ok: true, lineUserId: "U-test" }),
  lineAuthUnauthorizedResponse: () => new Response(null, { status: 401 }),
}));

vi.mock("@/lib/atpocket", () => ({
  apiKeyForCalendarPocket1: () => "k1",
  apiKeyForCalendarWrite: () => "kw",
  fetchAppFields: async () => APP_FIELDS,
  fetchRecordById: async () => ({ record: h.caseRecord }),
  deleteRecord: async (_appId: string, recordId: string) => {
    h.deleteCalls.push(recordId);
  },
  isPocketHttpRateLimitError: () => false,
  listAuthsForAppList: () => [{ apiKey: "k1" }],
  fetchAllRecordsPages: async () => [],
  isPocketApiRateLimited: () => false,
}));

vi.mock("@/lib/atpocket-write-with-import-key", () => ({
  writePocketRecordWithImportKey: async (opts: {
    recordId: string;
    payload: Record<string, unknown>;
  }) => {
    h.writes.push({ recordId: opts.recordId, payload: opts.payload });
  },
}));

vi.mock("@/lib/audit-log", () => ({
  auditLogEnabled: () => true,
  recordAuditLog: async (opts: { operation: string }) => {
    h.auditOps.push(opts.operation);
    return { ok: true, written: 1 };
  },
}));

vi.mock("@/lib/customer-cancelled-t-numbers", () => ({
  isCustomerTNumberCancelled: async () => h.cancelled,
  fetchCancelledCustomerTNumbersCached: async () => new Set<string>(),
}));

vi.mock("@/lib/calendar-response-cache", () => ({
  invalidateAllCalendarPayloadCache: () => {},
}));

vi.mock("@/lib/calendar-construction-records-cache", () => ({
  fetchCalendarConstructionRecordsCached: async () => [],
  invalidateCalendarConstructionRecordsCache: () => {},
}));

vi.mock("@/lib/calendar-after-construction-save", () => ({
  finalizeConstructionCalendarSave: async (opts: {
    constructionRecordId: string | null;
    extraResponse?: Record<string, unknown>;
  }) =>
    Response.json({
      ok: true,
      customerInfoSynced: true,
      recordId: opts.constructionRecordId,
      ...(opts.extraResponse ?? {}),
    }),
}));

const { POST } = await import(
  "@/app/api/calendar/schedule-undated-case/route"
);

function post(body: Record<string, unknown>): Promise<Response> {
  return POST(
    new Request("https://example.test/schedule-undated-case", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function call(body: Record<string, unknown>) {
  const res = await post(body);
  return {
    status: res.status,
    body: (await res.json()) as {
      ok?: boolean;
      error?: string;
      scheduledWithoutSlot?: boolean;
    },
  };
}

const VALID = {
  caseRecordId: "5001",
  scheduledStartDate: "2026-09-05",
  contractor: "ピュアライフ",
  viewYear: 2026,
  viewMonth: 9,
};

beforeEach(() => {
  process.env.CALENDAR_APP_ID = "77";
  h.deleteCalls = [];
  h.writes = [];
  h.auditOps = [];
  h.cancelled = false;
  h.caseRecord = {
    "field-1": "T00003372",
    "field-2": "山田太郎",
    "field-3": "",
    "field-4": "",
    "field-5": "既築案件",
  };
});

describe("タスクS-3: 空き枠を使わずに施工予定日を登録する", () => {
  it("★ 施工予定日と施工会社を案件に書き込む（T番号は維持）", async () => {
    const { status, body } = await call(VALID);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.scheduledWithoutSlot).toBe(true);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].recordId).toBe("5001");
    expect(h.writes[0].payload).toMatchObject({
      // 取込キーの T番号は既存値を載せ直す（新規採番しない）
      "field-1": "T00003372",
      "field-2": "山田太郎",
      "field-3": "2026-09-05",
      "field-4": "ピュアライフ",
    });
  });

  it("★ 空き枠は削除しない（このルートに削除経路は無い）", async () => {
    await call(VALID);

    expect(h.deleteCalls).toEqual([]);
    expect(h.auditOps).toEqual(["update"]);
    expect(h.auditOps).not.toContain("delete");
  });

  it("★ 施工会社が未入力なら 400。@pocket へは書き込まない", async () => {
    const { status, body } = await call({ ...VALID, contractor: "" });

    expect(status).toBe(400);
    expect(body.error).toContain("施工会社");
    expect(h.writes).toEqual([]);
    expect(h.deleteCalls).toEqual([]);
  });

  it("施工予定日が未入力なら 400。@pocket へは書き込まない", async () => {
    const { status } = await call({ ...VALID, scheduledStartDate: "" });

    expect(status).toBe(400);
    expect(h.writes).toEqual([]);
  });

  it("案件が未指定なら 400", async () => {
    const { status } = await call({ ...VALID, caseRecordId: "" });

    expect(status).toBe(400);
    expect(h.writes).toEqual([]);
  });

  it("既に工事日が入っている案件は 409（未定案件だけを対象にする）", async () => {
    h.caseRecord = { ...h.caseRecord, "field-3": "2026-08-01" };

    const { status, body } = await call(VALID);

    expect(status).toBe(409);
    expect(body.error).toContain("既に工事日");
    expect(h.writes).toEqual([]);
    expect(h.deleteCalls).toEqual([]);
  });

  it("お客様名が空のレコード（＝空き枠）は対象外", async () => {
    h.caseRecord = { ...h.caseRecord, "field-2": "" };

    const { status } = await call(VALID);

    expect(status).toBe(400);
    expect(h.writes).toEqual([]);
  });

  it("キャンセル案件は登録しない", async () => {
    h.cancelled = true;

    const { status, body } = await call(VALID);

    expect(status).toBe(400);
    expect(body.error).toContain("キャンセル");
    expect(h.writes).toEqual([]);
  });
});
