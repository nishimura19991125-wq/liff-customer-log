import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 第3段階 3-2: お客様情報の案件を工事カレンダーへ載せる割り当て API。
 *
 * ここで固定するのは次の4つ。
 *   - 既存の工事レコードがあるときは**空き枠を使わない**（案A）
 *     同じ T番号 が2件になると自動照合が止まるため、この判定は省略できない
 *   - 空き枠を使うときは Aki番号 を引き継ぎ、T番号 はお客様情報のものを書く
 *   - **deleteRecord を一度も呼ばない**
 *   - 「探せなかった」ときは何も書かない（作りにいくと二重になる）
 */

const CAL_APP_ID = "cal-1";

const T_ID = "field-1";
const NAME_ID = "field-2";
const DATE_ID = "field-3";
const CONTRACTOR_ID = "field-4";
const HOUSING_ID = "field-5";
const HANDLER_ID = "field-6";
const AKI_ID = "field-101";

const APP_FIELDS = [
  { uniqueId: T_ID, caption: "T番号" },
  { uniqueId: NAME_ID, caption: "お客様名" },
  { uniqueId: DATE_ID, caption: "施工予定日" },
  { uniqueId: CONTRACTOR_ID, caption: "施工会社" },
  { uniqueId: HOUSING_ID, caption: "住宅ステータス" },
  { uniqueId: HANDLER_ID, caption: "工事対応者" },
  { uniqueId: AKI_ID, caption: "Aki番号" },
];

type Write = { recordId?: string; payload: Record<string, unknown> };

const h = vi.hoisted(() => ({
  /** @pocket の物理削除。1回でも呼ばれたら設計違反 */
  deleteCalls: [] as string[],
  writes: [] as Write[],
  audits: [] as { operation: string; recordId: string }[],
  /** T番号 での工事レコード検索が返す行 */
  lookupRows: [] as unknown[],
  lookupCalls: 0,
  lookupThrows: false,
  /** fetchRecordById（空き枠の単票）が返すレコード */
  slotRecord: null as Record<string, unknown> | null,
  /** お客様情報スナップショットの1件 */
  customer: {} as Record<string, unknown>,
  cancelled: false,
  finalize: [] as Record<string, unknown>[],
  akiOnCreate: "AKI-NEW" as string | null,
}));

vi.mock("@/lib/request-auth", () => ({
  resolveCallerLineAuth: async () => ({ ok: true, lineUserId: "U-test" }),
  lineAuthUnauthorizedResponse: () => new Response(null, { status: 401 }),
}));

vi.mock("@/lib/atpocket", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/atpocket")>("@/lib/atpocket");
  return {
    ...actual,
    apiKeyForCalendarPocket1: () => "k1",
    apiKeyForCalendarWrite: () => "kw",
    fetchAppFields: async () => APP_FIELDS,
    fetchRecordById: async () =>
      h.slotRecord ? { recordId: 7, record: h.slotRecord } : null,
    fetchRecordsList: async () => {
      h.lookupCalls += 1;
      if (h.lookupThrows) throw new Error("429 Too Many Requests");
      return { records: h.lookupRows };
    },
    deleteRecord: async (_appId: string, recordId: string) => {
      h.deleteCalls.push(recordId);
    },
  };
});

vi.mock("@/lib/atpocket-write-with-import-key", () => ({
  writePocketRecordWithImportKey: async (opts: {
    recordId?: string;
    payload: Record<string, unknown>;
  }) => {
    h.writes.push({
      ...(opts.recordId ? { recordId: opts.recordId } : {}),
      payload: opts.payload,
    });
    return opts.recordId
      ? undefined
      : { recordIdHint: "con-new", row: {}, location: null };
  },
}));

vi.mock("@/lib/audit-log", () => ({
  auditLogEnabled: () => true,
  recordAuditLog: async (o: { operation: string; targetRecordId: string }) => {
    h.audits.push({ operation: o.operation, recordId: o.targetRecordId });
    return { ok: true, written: 1 };
  },
}));

vi.mock("@/lib/calendar-construction-pocket-common", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/calendar-construction-pocket-common")
  >("@/lib/calendar-construction-pocket-common");
  return {
    ...actual,
    ensureConstructionImportKeyOnRecord: async () => h.akiOnCreate,
  };
});

vi.mock("@/lib/customer-cancelled-t-numbers", () => ({
  isCustomerTNumberCancelled: async () => h.cancelled,
  fetchCancelledCustomerTNumbersCached: async () => new Set<string>(),
}));

vi.mock("@/lib/customer-crm-list", () => ({
  getCachedCustomerCrmSnapshot: async () => ({
    items: [h.customer],
    apFieldId: null,
    clFieldId: null,
    creatorFieldId: null,
  }),
}));

vi.mock("@/lib/calendar-response-cache", () => ({
  invalidateAllCalendarPayloadCache: () => {},
}));

vi.mock("@/lib/calendar-construction-records-cache", () => ({
  invalidateCalendarConstructionRecordsCache: () => {},
  fetchCalendarConstructionRecordsCached: async () => [],
}));

vi.mock("@/lib/calendar-after-construction-save", () => ({
  finalizeConstructionCalendarSave: async (
    opts: Record<string, unknown> & { extraResponse?: Record<string, unknown> },
  ) => {
    h.finalize.push(opts);
    return Response.json({
      ok: true,
      recordId: opts.constructionRecordId,
      ...(opts.extraResponse ?? {}),
    });
  },
}));

vi.mock("@/lib/staff-construction-handler-candidates", () => ({
  constructionHandlerStaffConfigReady: () => true,
  resolveConstructionHandlerNameForActiveStaff: async (id: string) =>
    id === "staff-1"
      ? { ok: true, name: "工事 太郎" }
      : { ok: false, reason: "not_found" },
}));

const { POST } = await import("@/app/api/calendar/assign-customer-case/route");

const ENV_KEYS = [
  "CALENDAR_APP_ID",
  "CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID",
  "CALENDAR_EMPTY_FILL_CONSTRUCTION_HANDLER_FIELD_ID",
  "CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID",
  "CALENDAR_CONSTRUCTION_IMPORT_KEY_FIELD_ID",
] as const;
const savedEnv: Record<string, string | undefined> = {};

const BASE_BODY = {
  customerInfoRecordId: "cus-1",
  scheduledStartDate: "2026-12-01",
  contractor: "株式会社アルファ",
  constructionHandlerStaffRecordId: "staff-1",
};

/** 空き枠＝お客様名が空で施工予定日が入っている行 */
const EMPTY_SLOT = {
  [NAME_ID]: "",
  [DATE_ID]: "2026-12-01",
  [CONTRACTOR_ID]: "株式会社アルファ",
  [AKI_ID]: "AKI-SLOT",
};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.CALENDAR_APP_ID = CAL_APP_ID;
  process.env.CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID = NAME_ID;
  process.env.CALENDAR_EMPTY_FILL_CONSTRUCTION_HANDLER_FIELD_ID = HANDLER_ID;
  process.env.CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID = T_ID;
  process.env.CALENDAR_CONSTRUCTION_IMPORT_KEY_FIELD_ID = AKI_ID;

  h.deleteCalls.length = 0;
  h.writes.length = 0;
  h.audits.length = 0;
  h.lookupRows = [];
  h.lookupCalls = 0;
  h.lookupThrows = false;
  h.slotRecord = { ...EMPTY_SLOT };
  h.cancelled = false;
  h.finalize.length = 0;
  h.akiOnCreate = "AKI-NEW";
  h.customer = {
    recordId: "cus-1",
    customerName: "山田 太郎",
    tNumber: "T00003420",
    housingStatus: "既築案件",
    contractorName: "株式会社アルファ",
    isCancelled: false,
  };
});

function restoreEnv() {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

async function call(body: Record<string, unknown>) {
  const res = await POST(
    new Request("https://example.test/assign-customer-case", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const parsed = (await res.json()) as Record<string, unknown>;
  restoreEnv();
  return { status: res.status, body: parsed };
}

/** T番号 の検索が1件ヒットする（＝既存の工事レコードがある） */
function existingConstructionRow() {
  return {
    recordId: 55,
    record: {
      [T_ID]: "T00003420",
      [NAME_ID]: "山田 太郎",
      [AKI_ID]: "AKI-OLD",
    },
  };
}

describe("既存の工事レコードがあるとき（案A）", () => {
  it("★ 既存レコードに施工予定日・施工会社が書かれる", async () => {
    h.lookupRows = [existingConstructionRow()];

    const { status } = await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    expect(status).toBe(200);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]?.recordId).toBe("55");
    expect(h.writes[0]?.payload[DATE_ID]).toBe("2026-12-01");
    expect(h.writes[0]?.payload[CONTRACTOR_ID]).toBe("株式会社アルファ");
  });

  it("★ 空き枠に書かない・削除しない", async () => {
    h.lookupRows = [existingConstructionRow()];

    const { body } = await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    expect(h.writes.map((w) => w.recordId)).not.toContain("slot-9");
    expect(h.deleteCalls).toEqual([]);
    expect(body.slotUsed).toBe(false);
    expect(body.slotDeleted).toBe(false);
    expect(body.assignedTo).toBe("existing");
  });

  it("工事対応者が既存レコードにも書かれる", async () => {
    h.lookupRows = [existingConstructionRow()];
    await call({ ...BASE_BODY, slotRecordId: "slot-9" });
    expect(h.writes[0]?.payload[HANDLER_ID]).toBe("工事 太郎");
  });
});

describe("既存が無く空き枠があるとき", () => {
  it("★ 空き枠のレコードに書き込まれる（削除しない）", async () => {
    const { status, body } = await call({
      ...BASE_BODY,
      slotRecordId: "slot-9",
    });

    expect(status).toBe(200);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]?.recordId).toBe("slot-9");
    expect(h.writes[0]?.payload[NAME_ID]).toBe("山田 太郎");
    expect(h.deleteCalls).toEqual([]);
    expect(body.slotUsed).toBe(true);
    expect(body.slotDeleted).toBe(false);
    expect(body.assignedTo).toBe("slot");
  });

  it("★ Aki番号 は空き枠のものを引き継ぐ", async () => {
    await call({ ...BASE_BODY, slotRecordId: "slot-9" });
    expect(h.writes[0]?.payload[AKI_ID]).toBe("AKI-SLOT");
    expect(h.finalize[0]?.constructionImportKey).toBe("AKI-SLOT");
  });

  it("★ T番号 はお客様情報のものを書く", async () => {
    await call({ ...BASE_BODY, slotRecordId: "slot-9" });
    expect(h.writes[0]?.payload[T_ID]).toBe("T00003420");
    expect(h.finalize[0]?.constructionUniqueKey).toBe("T00003420");
  });

  /**
   * 実機で「工事登録アプリに T番号 が入らない」が出た。
   * 書き戻しの判定に突合キーを使っていたため、お客様情報側の T番号 と
   * 一致して書き戻しが飛んでいた。入っている前提にしない
   */
  it("★ 連携後の T番号 書き戻しを飛ばさない", async () => {
    await call({ ...BASE_BODY, slotRecordId: "slot-9" });
    expect(h.finalize[0]?.constructionRecordTNumber).toBe("");
  });

  it("住宅ステータス・工事対応者・施工予定日も書かれる", async () => {
    await call({ ...BASE_BODY, slotRecordId: "slot-9" });
    expect(h.writes[0]?.payload[HOUSING_ID]).toBe("既築案件");
    expect(h.writes[0]?.payload[HANDLER_ID]).toBe("工事 太郎");
    expect(h.writes[0]?.payload[DATE_ID]).toBe("2026-12-01");
  });

  it("住宅ステータスが空なら列ごと載せない（既存値を消さない）", async () => {
    h.customer = { ...h.customer, housingStatus: "" };
    await call({ ...BASE_BODY, slotRecordId: "slot-9" });
    expect(h.writes[0]?.payload).not.toHaveProperty(HOUSING_ID);
  });

  it("監査ログは update として1件だけ記録する（delete は残さない）", async () => {
    await call({ ...BASE_BODY, slotRecordId: "slot-9" });
    expect(h.audits).toEqual([{ operation: "update", recordId: "slot-9" }]);
  });

  it("★ 既に埋まっている枠なら 409 で何も書かない", async () => {
    h.slotRecord = { ...EMPTY_SLOT, [NAME_ID]: "先客 花子" };

    const { status, body } = await call({
      ...BASE_BODY,
      slotRecordId: "slot-9",
    });

    expect(status).toBe(409);
    expect(body.slotConflict).toBe(true);
    expect(h.writes).toEqual([]);
    expect(h.deleteCalls).toEqual([]);
  });
});

describe("既存も空き枠も無いとき", () => {
  it("★ 工事登録アプリに新規作成される", async () => {
    const { status } = await call(BASE_BODY);

    expect(status).toBe(200);
    expect(h.writes).toHaveLength(1);
    // 作成は recordId 無しの書き込み
    expect(h.writes[0]?.recordId).toBeUndefined();
    expect(h.writes[0]?.payload[T_ID]).toBe("T00003420");
    // 取込キーは空文字で載せる（@pocket が採番する）
    expect(h.writes[0]?.payload[AKI_ID]).toBe("");
    expect(h.deleteCalls).toEqual([]);
  });

  it("採番された Aki番号 が後処理へ渡る", async () => {
    const { body } = await call(BASE_BODY);
    expect(h.finalize[0]?.constructionImportKey).toBe("AKI-NEW");
    expect(body.assignedTo).toBe("new");
    expect(body.slotUsed).toBe(false);
  });

  it("★ 作成 payload に T番号 が載る", async () => {
    await call(BASE_BODY);
    expect(h.writes[0]?.payload[T_ID]).toBe("T00003420");
  });

  it("★ 連携後の T番号 書き戻しを飛ばさない", async () => {
    await call(BASE_BODY);
    expect(h.finalize[0]?.constructionRecordTNumber).toBe("");
  });

  it("空き枠を指定しない経路では T番号 検索を1回しかしない", async () => {
    await call(BASE_BODY);
    // linkCustomerInfoToConstruction の中の作成前照合のみ
    expect(h.lookupCalls).toBe(1);
  });
});

describe("何も書いてはいけないとき", () => {
  it("★ 同じ T番号 が複数見つかったら何もしない", async () => {
    h.lookupRows = [existingConstructionRow(), { recordId: 56, record: { [T_ID]: "T00003420" } }];

    const { status } = await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    expect(status).toBe(502);
    expect(h.writes).toEqual([]);
    expect(h.deleteCalls).toEqual([]);
  });

  it("★ 検索が例外なら何もしない", async () => {
    h.lookupThrows = true;

    const { status } = await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    expect(status).toBe(502);
    expect(h.writes).toEqual([]);
    expect(h.deleteCalls).toEqual([]);
  });

  it("★ 空き枠を使わない経路でも、検索が例外なら作らない", async () => {
    h.lookupThrows = true;

    const { status } = await call(BASE_BODY);

    expect(status).toBe(502);
    expect(h.writes).toEqual([]);
    expect(h.deleteCalls).toEqual([]);
  });

  it("★ T番号 が空なら弾く", async () => {
    h.customer = { ...h.customer, tNumber: "" };

    const { status, body } = await call({
      ...BASE_BODY,
      slotRecordId: "slot-9",
    });

    expect(status).toBe(400);
    expect(String(body.error)).toContain("T番号");
    expect(h.writes).toEqual([]);
  });

  it("★ 工事対応者が未指定なら弾く", async () => {
    const { status, body } = await call({
      ...BASE_BODY,
      constructionHandlerStaffRecordId: "",
      slotRecordId: "slot-9",
    });

    expect(status).toBe(400);
    expect(String(body.error)).toContain("工事対応者");
    expect(h.writes).toEqual([]);
  });

  it("稼働していない工事対応者は弾く", async () => {
    const { status } = await call({
      ...BASE_BODY,
      constructionHandlerStaffRecordId: "staff-x",
    });
    expect(status).toBe(400);
    expect(h.writes).toEqual([]);
  });

  it("キャンセル案件は弾く", async () => {
    h.customer = { ...h.customer, isCancelled: true };
    const { status } = await call({ ...BASE_BODY, slotRecordId: "slot-9" });
    expect(status).toBe(400);
    expect(h.writes).toEqual([]);
  });

  it("キャンセルT番号の照合でも弾く", async () => {
    h.cancelled = true;
    const { status } = await call({ ...BASE_BODY, slotRecordId: "slot-9" });
    expect(status).toBe(400);
    expect(h.writes).toEqual([]);
  });

  it("お客様情報に無いレコードIDなら 404", async () => {
    const { status } = await call({
      ...BASE_BODY,
      customerInfoRecordId: "cus-unknown",
    });
    expect(status).toBe(404);
    expect(h.writes).toEqual([]);
  });

  it("施工会社が空なら弾く", async () => {
    const { status } = await call({ ...BASE_BODY, contractor: "" });
    expect(status).toBe(400);
    expect(h.writes).toEqual([]);
  });

  it("施工予定日が不正なら弾く", async () => {
    const { status } = await call({ ...BASE_BODY, scheduledStartDate: "" });
    expect(status).toBe(400);
    expect(h.writes).toEqual([]);
  });
});

describe("工事対応者フィールドが未設定の環境", () => {
  it("fill-empty-slot と同じく必須にせず、値も書かない", async () => {
    delete process.env.CALENDAR_EMPTY_FILL_CONSTRUCTION_HANDLER_FIELD_ID;

    const { status } = await call({
      customerInfoRecordId: "cus-1",
      scheduledStartDate: "2026-12-01",
      contractor: "株式会社アルファ",
      slotRecordId: "slot-9",
    });

    expect(status).toBe(200);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]?.payload).not.toHaveProperty(HANDLER_ID);
  });
});
