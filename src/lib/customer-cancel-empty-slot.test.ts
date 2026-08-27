import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 空き枠の作成が @pocket で 400 になった件の修正。
 *
 * 原因は取込キー（T番号）の列を payload に載せていなかったこと。
 * writePocketRecordWithImportKey は「取込キーで既存を探して更新する」ための
 * 関数で、新規作成では素通しになるだけだった。createRecord を直接使う。
 */

const h = vi.hoisted(() => ({
  createCalls: [] as Array<{
    appId: string;
    payload: Record<string, unknown>;
    apiKey: string | undefined;
  }>,
  importKeyWriteCalls: [] as Array<Record<string, unknown>>,
  updateCalls: [] as Array<Record<string, unknown>>,
  auditOps: [] as string[],
  /** T番号で引ける工事レコード */
  records: [] as Array<{ recordId: number; record: Record<string, unknown> }>,
  /** true のとき createRecord が @pocket の 400 を投げる */
  failCreate: false,
  /** true のとき recordAuditLog が ok:false を返す */
  auditFails: false,
  /** true のとき recordAuditLog が投げる */
  auditThrows: false,
}));

const APP_FIELDS = [
  { uniqueId: "field-1", caption: "T番号" },
  { uniqueId: "field-2", caption: "お客様名" },
  { uniqueId: "field-3", caption: "施工予定日" },
  { uniqueId: "field-4", caption: "施工会社" },
  { uniqueId: "field-5", caption: "顧客ステータス" },
  { uniqueId: "field-6", caption: "工事対応者" },
  // 取込キー。@pocket が自動採番する（工事アプリの T番号 は採番しなくなった）
  { uniqueId: "field-101", caption: "Aki番号" },
];

vi.mock("@/lib/atpocket", () => ({
  apiKeyForCalendarPocket1: () => "read-key",
  apiKeyForCalendarWrite: () => "write-key",
  fetchAppFields: async () => APP_FIELDS,
  createRecord: async (
    appId: string,
    payload: Record<string, unknown>,
    auth?: { apiKey?: string },
  ) => {
    h.createCalls.push({ appId, payload, apiKey: auth?.apiKey });
    if (h.failCreate) {
      throw new Error("@pocket create record failed: 400 ...");
    }
    return {
      row: { recordId: 9001 },
      location: null,
      recordIdHint: "9001",
      rawBody: null,
    };
  },
}));

vi.mock("@/lib/atpocket-write-with-import-key", () => ({
  writePocketRecordWithImportKey: async (opts: Record<string, unknown>) => {
    h.importKeyWriteCalls.push(opts);
    h.updateCalls.push(opts.payload as Record<string, unknown>);
    return undefined;
  },
}));

vi.mock("@/lib/calendar-construction-records-cache", () => ({
  fetchCalendarConstructionRecordsCached: async () => h.records,
  invalidateCalendarConstructionRecordsCache: () => {},
}));

vi.mock("@/lib/calendar-response-cache", () => ({
  invalidateAllCalendarPayloadCache: () => {},
}));

vi.mock("@/lib/audit-log", () => ({
  auditLogEnabled: () => true,
  recordAuditLog: async (opts: { operation: string }) => {
    h.auditOps.push(opts.operation);
    if (h.auditThrows) {
      throw new Error("[audit-log] 更新履歴アプリの列を解決できません");
    }
    if (h.auditFails) {
      return { ok: false, error: "更新履歴アプリの列を解決できません" };
    }
    return { ok: true, written: 1 };
  },
}));

vi.mock("@/lib/japan-holidays-api", () => ({
  // 祝日は取れた前提（土日のみのフォールバックは別テストで見ている）
  fetchJapanHolidayKeysForRange: async () => ({
    keys: new Set<string>(),
    degraded: false,
  }),
}));

const { buildEmptySlotPayload, runCustomerCancelSideEffects } = await import(
  "@/lib/customer-cancel-server"
);

beforeEach(() => {
  process.env.CALENDAR_APP_ID = "77";
  delete process.env.CALENDAR_CUSTOMER_STATUS_FIELD_ID;
  h.createCalls = [];
  h.importKeyWriteCalls = [];
  h.updateCalls = [];
  h.auditOps = [];
  h.failCreate = false;
  h.auditFails = false;
  h.auditThrows = false;
  h.records = [
    {
      recordId: 5001,
      record: {
        "field-1": "T00003372",
        "field-2": "山田太郎",
        "field-3": "2026-12-01",
        "field-4": "ピュアライフ",
      },
    },
  ];
});

/** 十分に先の日付＝空き枠を作る条件を満たす */
const FAR_FUTURE = {
  tNumber: "T00003372",
  constructionDate: "2026-12-01",
  contractor: "ピュアライフ",
  todayDayKey: "2026-09-01",
  lineUserId: "U-test",
};

describe("★ 空き枠の payload", () => {
  it("★ 取込キー（Aki番号）の列を空文字で載せる", () => {
    const payload = buildEmptySlotPayload({
      importKeyFieldId: "field-1",
      startDateFieldId: "field-3",
      contractorFieldId: "field-4",
      customerStatusFieldId: "field-5",
      dayKey: "2026-12-01",
      contractor: "ピュアライフ",
    });

    // 列が無いと @pocket が「取込設定にキー項目を追加してください」で弾く。
    // 値は空。空なら自動採番される
    expect(payload).toHaveProperty("field-1", "");
  });

  it("★ 既存の空き枠と同じ構成（顧客ステータス=工事待ち・施工予定日・施工会社）", () => {
    const payload = buildEmptySlotPayload({
      importKeyFieldId: "field-1",
      startDateFieldId: "field-3",
      contractorFieldId: "field-4",
      customerStatusFieldId: "field-5",
      dayKey: "2026-12-01",
      contractor: "ピュアライフ",
    });

    expect(payload).toEqual({
      "field-1": "", // T番号（自動採番）
      "field-3": "2026-12-01", // 施工予定日
      "field-4": "ピュアライフ", // 施工会社
      "field-5": "工事待ち", // 顧客ステータス
    });
  });

  it("お客様名は載せない（空のままで空き枠として扱われる）", () => {
    const payload = buildEmptySlotPayload({
      importKeyFieldId: "field-1",
      startDateFieldId: "field-3",
      contractorFieldId: "field-4",
      customerStatusFieldId: "field-5",
      dayKey: "2026-12-01",
      contractor: "ピュアライフ",
    });

    expect(payload).not.toHaveProperty("field-2");
  });

  it("顧客ステータス列を解決できないときはその列だけ落ちる", () => {
    const payload = buildEmptySlotPayload({
      importKeyFieldId: "field-1",
      startDateFieldId: "field-3",
      contractorFieldId: "field-4",
      customerStatusFieldId: null,
      dayKey: "2026-12-01",
      contractor: "ピュアライフ",
    });

    expect(payload).toEqual({
      "field-1": "",
      "field-3": "2026-12-01",
      "field-4": "ピュアライフ",
    });
  });
});

describe("★ 空き枠の書き込み経路", () => {
  it("createRecord が呼ばれる", async () => {
    const result = await runCustomerCancelSideEffects(FAR_FUTURE);

    expect(result.emptySlotCreated).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(h.createCalls).toHaveLength(1);
    expect(h.createCalls[0].appId).toBe("77");
  });

  it("★ 空き枠の作成に writePocketRecordWithImportKey を使わない", async () => {
    await runCustomerCancelSideEffects(FAR_FUTURE);

    // 呼ばれるのは工事レコードの「更新」1回だけ。作成では使わない
    expect(h.importKeyWriteCalls).toHaveLength(1);
    expect(h.importKeyWriteCalls[0]).toHaveProperty("recordId", "5001");
  });

  it("★ 書き込む内容が既存の空き枠と同じ構成", async () => {
    await runCustomerCancelSideEffects(FAR_FUTURE);

    expect(h.createCalls[0].payload).toEqual({
      // 取込キーは Aki番号。T番号（field-1）は載せない（採番されないため）
      "field-101": "",
      "field-3": "2026-12-01",
      "field-4": "ピュアライフ",
      "field-5": "工事待ち",
    });
  });

  it("★ 書き込み権限のあるキー（create-record と同じ）を渡す", async () => {
    await runCustomerCancelSideEffects(FAR_FUTURE);

    expect(h.createCalls[0].apiKey).toBe("write-key");
  });

  it("★ 監査ログに作成が記録される", async () => {
    const result = await runCustomerCancelSideEffects(FAR_FUTURE);

    // 工事レコードの更新（update）と空き枠の作成（create）
    expect(h.auditOps).toEqual(["update", "create"]);
    expect(result.emptySlotRecordId).toBe("9001");
  });

  it("条件を満たさない日付では作らない（createRecord も呼ばない）", async () => {
    const result = await runCustomerCancelSideEffects({
      ...FAR_FUTURE,
      constructionDate: "2026-09-03",
    });

    expect(result.emptySlotCreated).toBe(false);
    expect(h.createCalls).toHaveLength(0);
    expect(h.auditOps).toEqual(["update"]);
  });

  it("★ 監査ログが失敗しても、作成は成功として扱う", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.auditFails = true;

    const result = await runCustomerCancelSideEffects(FAR_FUTURE);

    // 作成は済んでいる。「作成に失敗」と表示してはいけない
    expect(result.emptySlotCreated).toBe(true);
    expect(result.emptySlotRecordId).toBe("9001");
    expect(result.warnings).toEqual([]);
    // 失敗はサーバログに留める
    const logged = errorSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("監査ログを残せませんでした");
  });

  it("★ 監査ログが例外を投げても、作成は成功として扱う", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.auditThrows = true;

    const result = await runCustomerCancelSideEffects(FAR_FUTURE);

    expect(result.emptySlotCreated).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("★ 工事レコードの更新も、監査ログの失敗では失敗扱いにしない", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.auditFails = true;

    const result = await runCustomerCancelSideEffects(FAR_FUTURE);

    expect(result.constructionUpdated).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("作成に失敗しても投げず、警告を返す", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.failCreate = true;

    const result = await runCustomerCancelSideEffects(FAR_FUTURE);

    expect(result.emptySlotCreated).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("空き枠の作成に失敗");
    expect(errorSpy).toHaveBeenCalled();
  });
});
