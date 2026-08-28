import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONSTRUCTION_SLOT_KEEP_FIELD_LABELS } from "@/lib/calendar-empty-slot-reset";

/**
 * 工事日変更 M-2: 案件を別の日へ移す。
 *
 * ここで固定するのは次の5つ。
 *   - 移動先（空き枠 / 新規）へ案件が書かれ、Aki番号 の扱いが仕様どおり
 *   - 移動元は4列だけ空になり、施工予定日・施工会社・Aki番号 は残る
 *   - **deleteRecord を一度も呼ばない**
 *   - 事前検証で少しでも食い違えば何も書かない
 *   - W2 が失敗しても W1 の結果は残り、名指しのエラーが返る
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
  audits: [] as { operation: string; recordId: string; note: string }[],
  /** recordId → レコード。fetchRecordById が引く */
  records: {} as Record<string, Record<string, unknown> | null>,
  /** 移動元の更新だけ失敗させる（W2 失敗の再現） */
  failWriteFor: null as string | null,
  cancelled: false,
  finalize: [] as Record<string, unknown>[],
  akiOnCreate: "AKI-NEW" as string | null,
  createdRecordId: "con-new" as string | null,
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
    listAuthsForAppList: () => [{ apiKey: "k1" }],
    apiKeyForCalendarWrite: () => "kw",
    fetchAppFields: async () => APP_FIELDS,
    fetchRecordById: async (_appId: string, recordId: string) => {
      const rec = h.records[recordId];
      return rec ? { recordId, record: rec } : null;
    },
    deleteRecord: async (_appId: string, recordId: string) => {
      h.deleteCalls.push(recordId);
    },
  };
});

vi.mock("@/lib/atpocket-write-with-import-key", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/atpocket-write-with-import-key")
  >("@/lib/atpocket-write-with-import-key");
  return {
    ...actual,
    writePocketRecordWithImportKey: async (opts: {
      recordId?: string;
      payload: Record<string, unknown>;
    }) => {
      if (opts.recordId && opts.recordId === h.failWriteFor) {
        throw new Error("@pocket update record failed: 500");
      }
      h.writes.push({
        ...(opts.recordId ? { recordId: opts.recordId } : {}),
        payload: opts.payload,
      });
      return opts.recordId
        ? undefined
        : { recordIdHint: h.createdRecordId, row: {}, location: null };
    },
  };
});

vi.mock("@/lib/calendar-construction-pocket-common", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/calendar-construction-pocket-common")
  >("@/lib/calendar-construction-pocket-common");
  return {
    ...actual,
    ensureConstructionImportKeyOnRecord: async () => h.akiOnCreate,
    resolveConstructionRecordAfterCreate: async () => ({
      recordId: h.createdRecordId,
      uniqueKey: h.akiOnCreate,
    }),
  };
});

vi.mock("@/lib/audit-log", () => ({
  auditLogEnabled: () => true,
  recordAuditLog: async (o: {
    operation: string;
    targetRecordId: string;
    changes?: Array<{ fieldId: string; after: string }>;
  }) => {
    const moveRow = o.changes?.find(
      (c) => c.fieldId === "__construction_case_move__",
    );
    h.audits.push({
      operation: o.operation,
      recordId: o.targetRecordId,
      note: moveRow?.after ?? "",
    });
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

const { POST } = await import(
  "@/app/api/calendar/move-construction-case/route"
);

const ENV_KEYS = [
  "CALENDAR_APP_ID",
  "CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID",
  "CALENDAR_EMPTY_FILL_CONSTRUCTION_HANDLER_FIELD_ID",
  "CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID",
  "CALENDAR_CONSTRUCTION_IMPORT_KEY_FIELD_ID",
] as const;
const savedEnv: Record<string, string | undefined> = {};

/** 12/1 の案件（移動元） */
const SOURCE_CASE = {
  [NAME_ID]: "山田 太郎",
  [T_ID]: "T00003420",
  [DATE_ID]: "2026-12-01",
  [CONTRACTOR_ID]: "株式会社アルファ",
  [HOUSING_ID]: "既築案件",
  [HANDLER_ID]: "工事 花子",
  [AKI_ID]: "AKI-100",
};

/** 12/5 の空き枠（移動先）。施工会社が違う */
const TARGET_SLOT = {
  [NAME_ID]: "",
  [DATE_ID]: "2026-12-05",
  [CONTRACTOR_ID]: "株式会社ベータ",
  [AKI_ID]: "AKI-217",
};

const BASE_BODY = {
  sourceRecordId: "con-1",
  targetDayKey: "2026-12-05",
  constructionHandlerStaffRecordId: "staff-1",
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
  h.records = { "con-1": { ...SOURCE_CASE }, "slot-9": { ...TARGET_SLOT } };
  h.failWriteFor = null;
  h.cancelled = false;
  h.finalize.length = 0;
  h.akiOnCreate = "AKI-NEW";
  h.createdRecordId = "con-new";
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function call(body: Record<string, unknown>) {
  const res = await POST(
    new Request("https://example.test/move-construction-case", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const parsed = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body: parsed };
}

/** 移動先への書き込み（1回目）と移動元の片付け（2回目） */
const movedWrite = () => h.writes[0];
const sourceWrite = () => h.writes[1];

describe("移動先に空き枠があるとき", () => {
  it("★ 空き枠のレコードに案件が書かれる", async () => {
    const { status, body } = await call({
      ...BASE_BODY,
      slotRecordId: "slot-9",
    });

    expect(status).toBe(200);
    expect(movedWrite()?.recordId).toBe("slot-9");
    expect(movedWrite()?.payload[NAME_ID]).toBe("山田 太郎");
    expect(movedWrite()?.payload[T_ID]).toBe("T00003420");
    expect(movedWrite()?.payload[DATE_ID]).toBe("2026-12-05");
    expect(body.movedTo).toBe("slot");
  });

  it("★ Aki番号 は移動先の枠のものを引き継ぐ", async () => {
    await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    expect(movedWrite()?.payload[AKI_ID]).toBe("AKI-217");
    expect(h.finalize[0]?.constructionImportKey).toBe("AKI-217");
  });

  it("★ 施工会社が違う枠へ移せる（施工会社も書き換わる）", async () => {
    await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    expect(movedWrite()?.payload[CONTRACTOR_ID]).toBe("株式会社ベータ");
  });

  it("住宅ステータス・工事対応者も移る", async () => {
    await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    expect(movedWrite()?.payload[HOUSING_ID]).toBe("既築案件");
    expect(movedWrite()?.payload[HANDLER_ID]).toBe("工事 太郎");
  });

  it("★ 枠は削除しない", async () => {
    const { body } = await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    expect(h.deleteCalls).toEqual([]);
    expect(body.slotDeleted).toBe(false);
  });
});

describe("移動先に空き枠が無いとき", () => {
  it("★ 新規レコードが作成される", async () => {
    const { status, body } = await call(BASE_BODY);

    expect(status).toBe(200);
    // 作成は recordId 無しの書き込み
    expect(movedWrite()?.recordId).toBeUndefined();
    expect(movedWrite()?.payload[T_ID]).toBe("T00003420");
    expect(movedWrite()?.payload[DATE_ID]).toBe("2026-12-05");
    expect(body.movedTo).toBe("new");
  });

  it("★ Aki番号 は空文字で載せて採番させる", async () => {
    await call(BASE_BODY);

    expect(movedWrite()?.payload[AKI_ID]).toBe("");
    expect(h.finalize[0]?.constructionImportKey).toBe("AKI-NEW");
  });

  it("施工会社は移動元のものを引き継ぐ", async () => {
    await call(BASE_BODY);

    expect(movedWrite()?.payload[CONTRACTOR_ID]).toBe("株式会社アルファ");
  });

  it("指定があればその施工会社を使う", async () => {
    await call({ ...BASE_BODY, contractor: "株式会社ガンマ" });

    expect(movedWrite()?.payload[CONTRACTOR_ID]).toBe("株式会社ガンマ");
  });
});

describe("移動元を空き枠へ戻す", () => {
  it("★ 4列が空文字になる", async () => {
    await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    expect(sourceWrite()?.recordId).toBe("con-1");
    expect(sourceWrite()?.payload).toEqual({
      [NAME_ID]: "",
      [T_ID]: "",
      [HOUSING_ID]: "",
      [HANDLER_ID]: "",
    });
  });

  it("★ 施工予定日・施工会社・Aki番号 は patch に入らない（残る）", async () => {
    await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    expect(sourceWrite()?.payload).not.toHaveProperty(DATE_ID);
    expect(sourceWrite()?.payload).not.toHaveProperty(CONTRACTOR_ID);
    expect(sourceWrite()?.payload).not.toHaveProperty(AKI_ID);
  });

  it("★ 残す列のラベルと、実際に残す列の数が一致する", async () => {
    await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    // ラベル（施工予定日・施工会社・Aki番号）と、patch に入らなかった列
    const keptIds = [DATE_ID, CONTRACTOR_ID, AKI_ID];
    expect(keptIds).toHaveLength(CONSTRUCTION_SLOT_KEEP_FIELD_LABELS.length);
    for (const id of keptIds) {
      expect(sourceWrite()?.payload).not.toHaveProperty(id);
    }
  });

  it("★ 成功したら応答で伝える", async () => {
    const { body } = await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    expect(body.sourceResetToEmptySlot).toBe(true);
    expect(body.sourceRecordId).toBe("con-1");
    expect(body.sourceDayKey).toBe("2026-12-01");
  });
});

describe("監査ログ", () => {
  it("★ 移動先と移動元の両方を記録し、移動と分かる", async () => {
    await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    expect(h.audits).toHaveLength(2);
    expect(h.audits[0]).toMatchObject({
      operation: "update",
      recordId: "slot-9",
    });
    expect(h.audits[0]?.note).toContain("con-1");
    expect(h.audits[1]).toMatchObject({
      operation: "update",
      recordId: "con-1",
    });
    expect(h.audits[1]?.note).toContain("2026-12-05");
  });

  it("新規作成のときは create で記録する", async () => {
    await call(BASE_BODY);

    expect(h.audits[0]).toMatchObject({
      operation: "create",
      recordId: "con-new",
    });
  });
});

describe("★ 事前検証（何も書かない）", () => {
  it("★ 移動元が空き枠なら弾く", async () => {
    h.records["con-1"] = { ...TARGET_SLOT };

    const { status } = await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    expect(status).toBe(409);
    expect(h.writes).toEqual([]);
  });

  it("★ 移動元の T番号 が画面と違えば弾く", async () => {
    const { status } = await call({
      ...BASE_BODY,
      slotRecordId: "slot-9",
      expectedTNumber: "T00009999",
    });

    expect(status).toBe(409);
    expect(h.writes).toEqual([]);
  });

  it("T番号 が一致すれば通る", async () => {
    const { status } = await call({
      ...BASE_BODY,
      slotRecordId: "slot-9",
      expectedTNumber: "T00003420",
    });

    expect(status).toBe(200);
  });

  it("★ 移動先の枠が埋まっていれば弾く", async () => {
    h.records["slot-9"] = { ...TARGET_SLOT, [NAME_ID]: "先客 花子" };

    const { status, body } = await call({
      ...BASE_BODY,
      slotRecordId: "slot-9",
    });

    expect(status).toBe(409);
    expect(body.slotConflict).toBe(true);
    expect(h.writes).toEqual([]);
  });

  it("★ 同じ日への移動は弾く（移動元だけ空になるのを防ぐ）", async () => {
    const { status } = await call({
      ...BASE_BODY,
      targetDayKey: "2026-12-01",
    });

    expect(status).toBe(400);
    expect(h.writes).toEqual([]);
  });

  it("★ T番号 が無い案件は弾く", async () => {
    h.records["con-1"] = { ...SOURCE_CASE, [T_ID]: "" };

    const { status, body } = await call(BASE_BODY);

    expect(status).toBe(400);
    expect(String(body.error)).toContain("T番号");
    expect(h.writes).toEqual([]);
  });

  it("キャンセル済みの案件は弾く", async () => {
    h.cancelled = true;

    const { status } = await call(BASE_BODY);

    expect(status).toBe(400);
    expect(h.writes).toEqual([]);
  });

  it("移動元が見つからなければ弾く", async () => {
    h.records["con-1"] = null;

    const { status } = await call(BASE_BODY);

    expect(status).toBe(404);
    expect(h.writes).toEqual([]);
  });

  it("移動元と移動先に同じレコードは指定できない", async () => {
    const { status } = await call({ ...BASE_BODY, slotRecordId: "con-1" });

    expect(status).toBe(400);
    expect(h.writes).toEqual([]);
  });

  it("工事対応者が未指定なら弾く", async () => {
    const { status } = await call({
      ...BASE_BODY,
      constructionHandlerStaffRecordId: "",
      slotRecordId: "slot-9",
    });

    expect(status).toBe(400);
    expect(h.writes).toEqual([]);
  });
});

describe("★ 移動元を戻せなかったとき", () => {
  it("★ 名指しのエラーを返し、W1 の結果は残る", async () => {
    h.failWriteFor = "con-1";

    const { status, body } = await call({
      ...BASE_BODY,
      slotRecordId: "slot-9",
    });

    expect(status).toBe(502);
    // 移動先への書き込みは済んでいる
    expect(movedWrite()?.recordId).toBe("slot-9");
    expect(body.constructionSaved).toBe(true);
    expect(body.sourceResetToEmptySlot).toBe(false);
    expect(body.sourceRecordId).toBe("con-1");
    expect(body.sourceDayKey).toBe("2026-12-01");
  });

  it("★ エラー文言に移動元のID・日付・重複・直すまで止まることが入る", async () => {
    h.failWriteFor = "con-1";

    const { body } = await call({ ...BASE_BODY, slotRecordId: "slot-9" });
    const msg = String(body.error);

    expect(msg).toContain("con-1");
    expect(msg).toContain("2026/12/01");
    expect(msg).toContain("2026/12/05");
    expect(msg).toContain("2日に重複");
    expect(msg).toContain("お客様名・T番号・住宅ステータス・工事対応者");
    expect(msg).toContain("割り当て・キャンセルはエラー");
  });

  it("★ 戻せなくても削除はしない", async () => {
    h.failWriteFor = "con-1";

    await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    expect(h.deleteCalls).toEqual([]);
  });

  it("★ 移動元が別の案件に変わっていたら消さない", async () => {
    // 再確認の GET で別の T番号 が返る
    h.records["con-1"] = { ...SOURCE_CASE };
    let reads = 0;
    const original = h.records["con-1"];
    Object.defineProperty(h.records, "con-1", {
      configurable: true,
      get() {
        reads += 1;
        // 1回目（事前検証）は本物、2回目以降（W2 直前の再確認）は別案件
        return reads <= 1 ? original : { ...SOURCE_CASE, [T_ID]: "T00009999" };
      },
    });

    const { status } = await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    expect(status).toBe(502);
    // 移動先には書いたが、移動元は消していない
    expect(h.writes).toHaveLength(1);
    expect(movedWrite()?.recordId).toBe("slot-9");
  });
});

describe("★ 後処理へ渡すもの", () => {
  it("★ 書き戻しを飛ばさない（3-2 と同じ理由）", async () => {
    await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    expect(h.finalize[0]?.constructionUniqueKey).toBe("T00003420");
    expect(h.finalize[0]?.constructionRecordTNumber).toBe("");
  });

  it("移動先のレコードIDを渡す", async () => {
    await call({ ...BASE_BODY, slotRecordId: "slot-9" });
    expect(h.finalize[0]?.constructionRecordId).toBe("slot-9");

    h.writes.length = 0;
    h.finalize.length = 0;
    await call(BASE_BODY);
    expect(h.finalize[0]?.constructionRecordId).toBe("con-new");
  });
});
