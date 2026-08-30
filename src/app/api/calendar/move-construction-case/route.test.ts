import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONSTRUCTION_SLOT_KEEP_FIELD_LABELS } from "@/lib/calendar-empty-slot-reset";

/**
 * 工事日変更 M-2: 案件を別の日へ移す。
 *
 * ここで固定するのは次の5つ。
 *   - 移動先（空き枠 / 新規）へ案件が書かれ、Aki番号 の扱いが仕様どおり
 *   - 移動元は4列だけ空になり、施工予定日・施工会社・Aki番号 は残る
 *   - **既定では deleteRecord を一度も呼ばない**
 *     （M-4 で sourceDisposition:"delete" を選んだときだけ消す）
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
  /** fetchRecordById で読んだ recordId の並び */
  reads: [] as string[],
  /** true のとき recordAuditLog が投げる */
  auditThrows: false,
  /** 削除ログの ok。false にすると A-4 で削除が止まる */
  deleteLogOk: true,
  /** 削除ログに渡された全項目の文字列 */
  deletionContents: [] as string[],
  /** この recordId の deleteRecord だけ失敗させる */
  failDeleteFor: null as string | null,
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
      h.reads.push(recordId);
      const rec = h.records[recordId];
      return rec ? { recordId, record: rec } : null;
    },
    deleteRecord: async (_appId: string, recordId: string) => {
      if (recordId === h.failDeleteFor) {
        throw new Error("@pocket delete record failed: 500");
      }
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
    deletionContent?: string;
    changes?: Array<{ fieldId: string; after: string }>;
  }) => {
    if (h.auditThrows) throw new Error("[audit-log] 列を解決できません");
    const moveRow = o.changes?.find(
      (c) => c.fieldId === "__construction_case_move__",
    );
    h.audits.push({
      operation: o.operation,
      recordId: o.targetRecordId,
      note: moveRow?.after ?? "",
    });
    if (o.operation === "delete") {
      h.deletionContents.push(o.deletionContent ?? "");
      if (!h.deleteLogOk) {
        return { ok: false, error: "削除対象の項目を取得できなかったため" };
      }
    }
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
  "CALENDAR_MOVE_DELETE_SOURCE_RECORD",
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
  h.reads.length = 0;
  h.auditThrows = false;
  h.deleteLogOk = true;
  h.deletionContents.length = 0;
  h.failDeleteFor = null;
  delete process.env.CALENDAR_MOVE_DELETE_SOURCE_RECORD;
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

/**
 * 第1段階の速度改善。移動1回で @pocket への往復が30回を超えており、
 * maxDuration=26 に対して余裕が乏しかった。呼び出しを減らしても
 * 監査ログ・移動の正しさが落ちないことを固定する。
 */
describe("★ 速度改善で落としてはいけないもの", () => {
  it("★ 監査ログは並走させても必ず記録される", async () => {
    // 応答を返す前に await している（Lambda はレスポンス後に凍結するので、
    // 投げっぱなしにすると書かれないまま消える）
    const { status } = await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    expect(status).toBe(200);
    expect(h.audits.map((a) => a.recordId)).toEqual(["slot-9", "con-1"]);
  });

  it("★ 移動元を戻せなかったときも監査ログを書き切る", async () => {
    h.failWriteFor = "con-1";

    const { status } = await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    expect(status).toBe(502);
    // W1 の監査ログは残る（W2 は書けていないので記録しない）
    expect(h.audits.map((a) => a.recordId)).toEqual(["slot-9"]);
  });

  it("★ 移動先の枠は1回しか読まない（鮮度確認を統合した）", async () => {
    await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    expect(h.reads.filter((id) => id === "slot-9")).toHaveLength(1);
  });

  it("★ 枠が埋まっていれば、その1回の読みで弾く", async () => {
    h.records["slot-9"] = { ...TARGET_SLOT, [NAME_ID]: "先客 花子" };

    const { status, body } = await call({
      ...BASE_BODY,
      slotRecordId: "slot-9",
    });

    expect(status).toBe(409);
    expect(body.slotConflict).toBe(true);
    expect(h.writes).toEqual([]);
  });

  it("★ カレンダーの即時反映パッチを組み立てない（捨てられるため）", async () => {
    await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    expect(h.finalize[0]?.skipCalendarPatch).toBe(true);
  });

  it("★ 監査ログが失敗しても移動は成功のまま", async () => {
    h.auditThrows = true;

    const { status } = await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    expect(status).toBe(200);
    expect(h.writes).toHaveLength(2);
  });
});

/**
 * M-4: 移動元を削除する選択肢。
 *
 * 物理削除なので、固定するのは「消せること」より
 * **消してはいけない場面で消さないこと**。1つでも条件が外れたら
 * 空き枠へ戻す動作へフォールバックし、移動そのものは成功させる。
 */
/**
 * 削除直前の取り直しだけ別の値を返す。
 * 1回目（事前検証）は元のまま、2回目以降を差し替える
 */
function sourceChangedOnRefetch(
  second: Record<string, unknown> | null,
): Record<string, Record<string, unknown> | null> {
  const base: Record<string, Record<string, unknown> | null> = {
    "con-1": { ...SOURCE_CASE },
    "slot-9": { ...TARGET_SLOT },
  };
  let reads = 0;
  return new Proxy(base, {
    get(target, prop) {
      if (prop === "con-1") {
        reads += 1;
        return reads >= 2 ? second : target["con-1"];
      }
      return target[prop as string];
    },
  });
}

describe("移動元を削除する（M-4）", () => {
  const DELETE_BODY = {
    ...BASE_BODY,
    slotRecordId: "slot-9",
    sourceDisposition: "delete" as const,
  };

  it("★ 既定（sourceDisposition なし）は従来どおり空き枠へ戻す", async () => {
    const { status, body } = await call({
      ...BASE_BODY,
      slotRecordId: "slot-9",
    });

    expect(status).toBe(200);
    expect(h.deleteCalls).toEqual([]);
    expect(body.sourceDeleted).toBe(false);
    expect(body.sourceResetToEmptySlot).toBe(true);
    // 4列を空にする更新が走っている
    expect(sourceWrite()?.recordId).toBe("con-1");
    expect(sourceWrite()?.payload[NAME_ID]).toBe("");
  });

  it('★ "keep" を明示しても消さない', async () => {
    const { body } = await call({
      ...BASE_BODY,
      slotRecordId: "slot-9",
      sourceDisposition: "keep",
    });

    expect(h.deleteCalls).toEqual([]);
    expect(body.sourceResetToEmptySlot).toBe(true);
  });

  it("★ 知らない値は keep に倒れる（古いクライアントが消す側へ倒れない）", async () => {
    const { body } = await call({
      ...BASE_BODY,
      slotRecordId: "slot-9",
      sourceDisposition: "DELETE",
    });

    expect(h.deleteCalls).toEqual([]);
    expect(body.sourceResetToEmptySlot).toBe(true);
  });

  it("★ 「削除する」を選ぶと移動元が削除される", async () => {
    const { status, body } = await call(DELETE_BODY);

    expect(status).toBe(200);
    expect(h.deleteCalls).toEqual(["con-1"]);
    expect(body.sourceDeleted).toBe(true);
    expect(body.sourceResetToEmptySlot).toBe(false);
  });

  it("★ 削除したときは空き枠へ戻す更新を走らせない", async () => {
    await call(DELETE_BODY);

    // 書き込みは移動先の1回だけ
    expect(h.writes).toHaveLength(1);
    expect(movedWrite()?.recordId).toBe("slot-9");
  });

  it("★ 順序は「書いてから消す」（W1 が先）", async () => {
    await call(DELETE_BODY);

    expect(h.writes).toHaveLength(1);
    expect(h.deleteCalls).toEqual(["con-1"]);
  });

  it("★ 削除の前に全項目で取り直す（削除ログの材料）", async () => {
    await call(DELETE_BODY);

    // 事前検証・空き枠・削除直前 で移動元を2回読む
    expect(h.reads.filter((r) => r === "con-1")).toHaveLength(2);
  });

  it("★ 削除の前に監査ログを記録する", async () => {
    await call(DELETE_BODY);

    const del = h.audits.find((a) => a.operation === "delete");
    expect(del?.recordId).toBe("con-1");
    expect(h.deletionContents).toHaveLength(1);
    // 全項目が入っている（お客様名・T番号・Aki番号）
    expect(h.deletionContents[0]).toContain("山田 太郎");
    expect(h.deletionContents[0]).toContain("T00003420");
    expect(h.deletionContents[0]).toContain("AKI-100");
  });

  it("★ 移動であることが後から分かる記録を残す", async () => {
    await call(DELETE_BODY);

    expect(
      h.audits.some((a) => a.note.includes("削除して工事日を移動")),
    ).toBe(true);
  });

  it("★ 削除ログを残せなければ削除しない（A-4）", async () => {
    h.deleteLogOk = false;

    const { status, body } = await call(DELETE_BODY);

    expect(status).toBe(200);
    expect(h.deleteCalls).toEqual([]);
    expect(body.sourceDeleted).toBe(false);
    // フォールバックして空き枠へ戻っている
    expect(body.sourceResetToEmptySlot).toBe(true);
    expect(sourceWrite()?.payload[NAME_ID]).toBe("");
    expect(String(body.sourceKeptNotice)).toContain("削除の記録を残せなかった");
  });

  it("★ 環境変数 false で削除が止まり、空き枠へ戻る", async () => {
    process.env.CALENDAR_MOVE_DELETE_SOURCE_RECORD = "false";

    const { status, body } = await call(DELETE_BODY);

    expect(status).toBe(200);
    expect(h.deleteCalls).toEqual([]);
    expect(body.sourceResetToEmptySlot).toBe(true);
    // 運用者が意図して止めているので、利用者には言わない
    expect(body.sourceKeptNotice).toBeUndefined();
  });

  it("★ 移動元が別の案件に変わっていたら削除も更新もしない", async () => {
    // 削除直前の取り直しで別の T番号 が返る。
    // 削除を見送ったあと、空き枠へ戻す側の再確認でも同じ理由で弾かれる。
    // 他人の案件を消すことも空にすることもしない
    h.records = sourceChangedOnRefetch({
      ...SOURCE_CASE,
      [T_ID]: "T00009999",
      [NAME_ID]: "鈴木 花子",
    });

    const { status, body } = await call(DELETE_BODY);

    expect(h.deleteCalls).toEqual([]);
    // 移動元には1文字も書いていない（書き込みは移動先の1回だけ）
    expect(h.writes).toHaveLength(1);
    // 空き枠へも戻せていないので、名指しで直させる
    expect(status).toBe(502);
    expect(body.constructionSaved).toBe(true);
    expect(String(body.error)).toContain("レコードID con-1");
  });

  it("★ 移動元が既に空き枠なら削除しない", async () => {
    h.records = sourceChangedOnRefetch({ ...SOURCE_CASE, [NAME_ID]: "" });

    const { body } = await call(DELETE_BODY);

    expect(h.deleteCalls).toEqual([]);
    expect(String(body.sourceKeptNotice)).toContain("既に空き枠");
  });

  it("★ 削除直前に取り直せなければ削除しない", async () => {
    h.records = sourceChangedOnRefetch(null);

    const { body } = await call(DELETE_BODY);

    expect(h.deleteCalls).toEqual([]);
    expect(String(body.sourceKeptNotice)).toContain("取得できなかった");
  });

  it("★ 削除に失敗したら、名指しのエラーを返す", async () => {
    h.failDeleteFor = "con-1";

    const { status, body } = await call(DELETE_BODY);

    expect(status).toBe(502);
    const msg = String(body.error);
    expect(msg).toContain("レコードID con-1");
    expect(msg).toContain("2026/12/01");
    expect(msg).toContain("2026/12/05");
    expect(msg).toContain("2日に重複して表示されています");
    expect(msg).toContain("レコードを削除してください");
    expect(msg).toContain("割り当て・キャンセルはエラー");
    // W1 の結果は残っている
    expect(body.constructionSaved).toBe(true);
    expect(body.sourceDeleted).toBe(false);
  });

  it("★ 削除に失敗しても空き枠へ戻す更新は走らせない", async () => {
    h.failDeleteFor = "con-1";

    await call(DELETE_BODY);

    // 削除ログを書いた直後の状態。黙って別の片付け方に倒さない
    expect(h.writes).toHaveLength(1);
  });

  it("★ 新規作成で移した場合も削除できる", async () => {
    const { status, body } = await call({
      ...BASE_BODY,
      sourceDisposition: "delete",
    });

    expect(status).toBe(200);
    expect(body.movedTo).toBe("new");
    expect(h.deleteCalls).toEqual(["con-1"]);
  });

  it("★ 移動先のレコードIDを特定できなければ削除しない", async () => {
    h.createdRecordId = null;

    const { status, body } = await call({
      ...BASE_BODY,
      sourceDisposition: "delete",
    });

    expect(status).toBe(200);
    expect(h.deleteCalls).toEqual([]);
    expect(String(body.sourceKeptNotice)).toContain("移動先のレコードを特定");
  });
});

/**
 * 枠の読み方と鮮度確認。
 *
 * 移動元と同じ fetchConstructionRecordRow へ揃える案（C案）は見送った。
 * 認証は同じキーで効果が期待できず、maxRetries が 5 → 1 になるぶん
 * 一時的な失敗で移動が止まりやすくなるため。ここで固定するのは
 * **読み方を変えていないこと**と**枠の鮮度確認が消えていないこと**。
 */
describe("枠の読み方と鮮度確認", () => {
  it("★ 再試行の効く読み方のまま（maxRetries を下げていない）", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/app/api/calendar/move-construction-case/route.ts"),
      "utf8",
    );

    expect(src).toContain("let slotRow = await fetchRecordById(");
    // fields 指定が拒否されたときの取り直しも残っている
    expect(src).toContain("slot-get-fallback");
  });

  it("★ 埋まった枠を弾く判定は残っている", async () => {
    // 先に別の案件が入った枠を選ぶ
    h.records["slot-9"] = { ...TARGET_SLOT, [NAME_ID]: "先客 一郎" };

    const { status, body } = await call({
      ...BASE_BODY,
      slotRecordId: "slot-9",
    });

    expect(status).toBe(409);
    expect(body.slotConflict).toBe(true);
    // 何も書いていない
    expect(h.writes).toEqual([]);
  });

  it("★ 空き枠なら今までどおり書ける", async () => {
    const { status } = await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    expect(status).toBe(200);
    expect(movedWrite()?.recordId).toBe("slot-9");
  });

  it("★ 枠が見つからなければ 404", async () => {
    h.records["slot-9"] = null;

    const { status } = await call({ ...BASE_BODY, slotRecordId: "slot-9" });

    expect(status).toBe(404);
  });
});
