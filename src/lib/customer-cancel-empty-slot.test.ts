import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 顧客ステータスをキャンセルにしたときの、工事登録アプリ側の処理。
 *
 * もとは「空き枠の作成が @pocket で 400 になった件」を固定するために
 * 作ったファイルで、名前もそこから来ている。空き枠の自動作成は廃止したので、
 * いま固定しているのは次の3つ。
 *   - 空き枠を作らないこと
 *   - 工事レコードの3項目を空にする更新（取込キーは Aki番号）
 *   - 工事レコードの引き当て（Aki番号 → T番号）
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

const { runCustomerCancelSideEffects } = await import(
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

/**
 * キャンセル処理へ渡す引数。
 * 以前は空き枠の判定用に施工予定日・施工会社・操作日も渡していたが、
 * 空き枠を作らなくなったので引数ごと無くなった
 */
const CANCEL_OPTS = {
  tNumber: "T00003372",
  lineUserId: "U-test",
};

/**
 * 空き枠の自動作成は廃止した。
 *
 * 以前は、施工予定日が7営業日より先のとき、同じ日・同じ施工会社の空き枠を
 * 新規作成していた。ここにあった次のテストは、**対象の処理ごと無くなった**
 * ので削除している（期待値の書き換えではない）。
 *   - 空き枠の payload（buildEmptySlotPayload）の4件
 *   - 空き枠の書き込み経路の8件（createRecord を呼ぶ・書き込みキー・
 *     監査ログに作成を残す・条件を満たさない日付では作らない・
 *     監査ログの失敗でも作成は成功・作成の失敗を警告にする）
 * 代わりに「作らない」ことを固定する。
 */
describe("★ 空き枠は作らない", () => {
  it("★ 工事レコードを更新できても、空き枠を新規作成しない", async () => {
    const result = await runCustomerCancelSideEffects(CANCEL_OPTS);

    expect(result.constructionUpdated).toBe(true);
    expect(h.createCalls).toHaveLength(0);
  });

  it("★ 監査ログに「作成」は残らない", async () => {
    await runCustomerCancelSideEffects(CANCEL_OPTS);

    expect(h.auditOps).not.toContain("create");
  });

  it("結果に空き枠の項目を含めない", async () => {
    const result = await runCustomerCancelSideEffects(CANCEL_OPTS);

    expect(result).not.toHaveProperty("emptySlotCreated");
    expect(result).not.toHaveProperty("emptySlotRecordId");
    expect(result).not.toHaveProperty("plan");
  });

  it("空き枠の作成に関する警告は出ない", async () => {
    // 以前はここで「空き枠の作成に失敗しました」の警告が出ていた
    h.failCreate = true;

    const result = await runCustomerCancelSideEffects(CANCEL_OPTS);

    expect(result.warnings).toEqual([]);
  });
});

/**
 * 監査ログはベストエフォート（A-5）。記録の失敗を書き込みの失敗に見せない。
 * 空き枠の作成側にあった同じ主張のテストは、作成ごと無くなった。
 */
describe("★ 工事レコードの更新と監査ログ", () => {
  it("★ 工事レコードの更新も、監査ログの失敗では失敗扱いにしない", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.auditFails = true;

    const result = await runCustomerCancelSideEffects(CANCEL_OPTS);

    expect(result.constructionUpdated).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("監査ログが例外を投げても、更新は成功として扱う", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.auditThrows = true;

    const result = await runCustomerCancelSideEffects(CANCEL_OPTS);

    expect(result.constructionUpdated).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});

/**
 * 実機で「キャンセルしても案件が工事カレンダーに残る」が出た件。
 *
 * 原因は工事レコードを空にする**更新**の取込キーが T番号 のままだったこと。
 * db2ee62 で空き枠の**作成**だけ Aki番号 へ移し、更新が残っていた。
 * @pocket は取込キーの列が本文に無いと更新を 400 で返すので、
 * 施工予定日が消えず、空き枠の作成も道連れで飛んでいた。
 */
describe("★ 工事レコードを空にする更新の取込キー", () => {
  it("★ 取込キーは Aki番号。T番号 ではない", async () => {
    await runCustomerCancelSideEffects(CANCEL_OPTS);

    expect(h.importKeyWriteCalls).toHaveLength(1);
    // field-101 = Aki番号 / field-1 = T番号
    expect(h.importKeyWriteCalls[0].importKeyFieldId).toBe("field-101");
    expect(h.importKeyWriteCalls[0].importKeyFieldId).not.toBe("field-1");
  });

  it("★ Aki番号 が無い移行前の案件でもキャンセルできる", async () => {
    // 他の工事アプリ更新と同じ扱い。ここで例外にすると
    // 「Aki番号 が無い案件はキャンセルできない」になってしまう
    await runCustomerCancelSideEffects(CANCEL_OPTS);

    expect(h.importKeyWriteCalls[0].allowMissingImportKey).toBe(true);
  });

  it("★ 空にするのは施工予定日・施工会社・工事対応者の3つ", async () => {
    await runCustomerCancelSideEffects(CANCEL_OPTS);

    expect(h.updateCalls[0]).toEqual({
      "field-3": "",
      "field-4": "",
      "field-6": "",
    });
  });
});

describe("★ 工事レコードの引き当て", () => {
  it("★ T番号 が転記されていなくても Aki番号 で引ける", async () => {
    // 第1段階以降に作られた案件。工事側の T番号 がまだ空
    h.records = [
      {
        recordId: 5002,
        record: {
          "field-101": "A0042",
          "field-2": "山田太郎",
          "field-3": "2026-12-01",
          "field-4": "ピュアライフ",
        },
      },
    ];

    const result = await runCustomerCancelSideEffects({
      ...CANCEL_OPTS,
      akiNumber: "A0042",
    });

    expect(result.constructionUpdated).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(h.importKeyWriteCalls[0]).toHaveProperty("recordId", "5002");
  });

  it("★ Aki番号 が無い移行前の案件は従来どおり T番号 で引ける", async () => {
    const result = await runCustomerCancelSideEffects(CANCEL_OPTS);

    expect(result.constructionUpdated).toBe(true);
    expect(h.importKeyWriteCalls[0]).toHaveProperty("recordId", "5001");
  });

  it("★ Aki番号 を優先する（同じ一覧に両方あるとき）", async () => {
    h.records = [
      // T番号 だけ一致する別レコード
      { recordId: 5001, record: { "field-1": "T00003372" } },
      // Aki番号 が一致する本命
      { recordId: 5002, record: { "field-101": "A0042" } },
    ];

    await runCustomerCancelSideEffects({ ...CANCEL_OPTS, akiNumber: "A0042" });

    expect(h.importKeyWriteCalls[0]).toHaveProperty("recordId", "5002");
  });

  it("どちらでも引けなければ更新しない（空き枠も作らない）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.records = [];

    const result = await runCustomerCancelSideEffects(CANCEL_OPTS);

    expect(result.constructionUpdated).toBe(false);
    expect(h.importKeyWriteCalls).toHaveLength(0);
    expect(h.createCalls).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    warnSpy.mockRestore();
  });
});
