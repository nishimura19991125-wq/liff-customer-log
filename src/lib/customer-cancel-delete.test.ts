import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 顧客ステータスをキャンセルにしたとき、工事レコードを**削除する**。
 *
 * 以前は3項目（施工予定日・施工会社・工事対応者）を空にしてレコードを
 * 残していた。お客様名と T番号 が残るので空き枠にもならず、宙に浮いていた。
 *
 * 物理削除は元に戻せないので、「消さない側」に倒れることを厚めに見る。
 *   - 同じ案件のレコードが複数あるときは消さない
 *   - 削除の記録（監査ログ）を残せないときは消さない
 *   - 取り直したレコードが読めない・別の案件になっていたら消さない
 *
 * 削除を止めているとき（環境変数 false）の従来動作は
 * customer-cancel-update-fallback.test.ts が持っている。
 */

const T_NUMBER = "T99990001";
const AKI_NUMBER = "A9001";
const CUSTOMER_NAME = "試験 太郎";

const APP_FIELDS = [
  { uniqueId: "field-1", caption: "T番号" },
  { uniqueId: "field-2", caption: "お客様名" },
  { uniqueId: "field-3", caption: "施工予定日" },
  { uniqueId: "field-4", caption: "施工会社" },
  { uniqueId: "field-6", caption: "工事対応者" },
  { uniqueId: "field-7", caption: "メモ" },
  { uniqueId: "field-101", caption: "Aki番号" },
];

type Row = { recordId: number; record: Record<string, unknown> };

const h = vi.hoisted(() => ({
  /** 一覧（照合に使う） */
  records: [] as { recordId: number; record: Record<string, unknown> }[],
  /** 単票の取り直しが返す中身。未指定なら一覧の同じIDの行を返す */
  freshById: {} as Record<string, Record<string, unknown> | null>,
  getThrows: false,
  /** 呼ばれた順（get / audit / delete）。順序の確認に使う */
  events: [] as string[],
  gets: [] as { recordId: string; fieldsCsv: string | undefined }[],
  audits: [] as Record<string, unknown>[],
  auditFails: false,
  auditThrows: false,
  deleteCalls: [] as { recordId: string; apiKey: string | undefined }[],
  deleteThrows: false,
  updateWrites: [] as Record<string, unknown>[],
  createCalls: 0,
}));

vi.mock("@/lib/atpocket", () => ({
  apiKeyForCalendarPocket1: () => "read-key",
  apiKeyForCalendarWrite: () => "write-key",
  fetchAppFields: async () => APP_FIELDS,
  fetchRecordById: async (
    _appId: string,
    recordId: string,
    _auth: unknown,
    fieldsCsv?: string,
  ) => {
    h.events.push("get");
    h.gets.push({ recordId, fieldsCsv });
    if (h.getThrows) throw new Error("@pocket get record failed: 500");
    if (recordId in h.freshById) {
      const rec = h.freshById[recordId];
      return rec ? { recordId: Number(recordId), record: rec } : null;
    }
    const row = h.records.find((r) => String(r.recordId) === recordId);
    return row ? { recordId: row.recordId, record: row.record } : null;
  },
  deleteRecord: async (
    _appId: string,
    recordId: string,
    auth?: { apiKey?: string },
  ) => {
    h.events.push("delete");
    if (h.deleteThrows) throw new Error("@pocket delete record failed: 500");
    h.deleteCalls.push({ recordId, apiKey: auth?.apiKey });
  },
  createRecord: async () => {
    h.createCalls += 1;
    return { row: { recordId: 9001 }, location: null, recordIdHint: "9001" };
  },
}));

vi.mock("@/lib/atpocket-write-with-import-key", () => ({
  writePocketRecordWithImportKey: async (opts: Record<string, unknown>) => {
    h.updateWrites.push(opts);
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
  recordAuditLog: async (entry: Record<string, unknown>) => {
    h.events.push("audit");
    h.audits.push(entry);
    if (h.auditThrows) throw new Error("[audit-log] 想定外の例外");
    if (h.auditFails) {
      return { ok: false, error: "更新履歴アプリに書けませんでした" };
    }
    return { ok: true, written: 1 };
  },
}));

const { runCustomerCancelSideEffects } = await import(
  "@/lib/customer-cancel-server"
);

const ENV_KEYS = [
  "CALENDAR_APP_ID",
  "CUSTOMER_CANCEL_DELETE_CONSTRUCTION_RECORD",
  "CALENDAR_CONSTRUCTION_IMPORT_KEY_FIELD_ID",
  "CALENDAR_CONSTRUCTION_UNIQUE_KEY_FIELD_ID",
  "CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID",
] as const;
const savedEnv: Record<string, string | undefined> = {};

let infoSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

/** この案件の工事レコード（Aki番号・T番号 の両方が入っている） */
const caseRow = (id: number, extra: Record<string, unknown> = {}): Row => ({
  recordId: id,
  record: {
    "field-1": T_NUMBER,
    "field-2": CUSTOMER_NAME,
    "field-3": "2026-12-01",
    "field-4": "試験工務店",
    "field-6": "工事 花子",
    "field-7": "現場メモ",
    "field-101": AKI_NUMBER,
    ...extra,
  },
});

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.CALENDAR_APP_ID = "77";
  h.records = [caseRow(5001)];
  h.freshById = {};
  h.getThrows = false;
  h.events = [];
  h.gets = [];
  h.audits = [];
  h.auditFails = false;
  h.auditThrows = false;
  h.deleteCalls = [];
  h.deleteThrows = false;
  h.updateWrites = [];
  h.createCalls = 0;
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  infoSpy.mockRestore();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function cancel(extra: { akiNumber?: string } = { akiNumber: AKI_NUMBER }) {
  return runCustomerCancelSideEffects({
    tNumber: T_NUMBER,
    lineUserId: "U-test",
    ...extra,
  });
}

function allLoggedText(): string {
  return [infoSpy, warnSpy, errorSpy]
    .flatMap((spy) => spy.mock.calls)
    .map((c) => c.map((x) => String(x)).join(" "))
    .join("\n");
}

/** 再試行を促す言い回し。キャンセル済みを保存し直しても後段は走らない */
const RETRY_WORDS = [
  "時間をおいて",
  "もう一度",
  "再度",
  "再試行",
  "お試し",
  "やり直",
  "し直",
  "しばらく",
];

describe("★ キャンセルで工事レコードを削除する", () => {
  it("★ 工事レコードが削除される", async () => {
    const result = await cancel();

    expect(result).toEqual({
      warnings: [],
      constructionUpdated: false,
      constructionDeleted: true,
    });
    expect(h.deleteCalls).toEqual([{ recordId: "5001", apiKey: "write-key" }]);
  });

  it("★ 3項目を空にする更新は行わない", async () => {
    await cancel();

    expect(h.updateWrites).toEqual([]);
  });

  it("T番号 だけで引けた案件（Aki番号 の控えなし）も削除される", async () => {
    h.records = [caseRow(5001, { "field-101": "" })];

    const result = await cancel({});

    expect(result.constructionDeleted).toBe(true);
    expect(h.deleteCalls.map((d) => d.recordId)).toEqual(["5001"]);
  });

  it("同じレコードが Aki番号 と T番号 の両方で一致しても1件として削除する", async () => {
    // 1件のレコードに両方入っているのが通常の形
    const result = await cancel();

    expect(result.constructionDeleted).toBe(true);
    expect(h.deleteCalls).toHaveLength(1);
  });

  it("★ 空き枠は作らない", async () => {
    await cancel();

    expect(h.createCalls).toBe(0);
    expect(h.audits.map((a) => a.operation)).toEqual(["delete"]);
  });
});

describe("★ 削除前の監査ログ（A-4）", () => {
  it("★ 取り直し → 監査ログ → 削除 の順で行う", async () => {
    await cancel();

    expect(h.events).toEqual(["get", "audit", "delete"]);
  });

  it("★ 削除直前に、列を絞らずにレコードを取り直す", async () => {
    await cancel();

    expect(h.gets).toEqual([{ recordId: "5001", fieldsCsv: undefined }]);
  });

  it("★ 監査ログは operation: delete で、全項目を1つの文字列にして残す", async () => {
    await cancel();

    expect(h.audits).toHaveLength(1);
    const entry = h.audits[0]!;
    expect(entry.operation).toBe("delete");
    expect(entry.targetRecordId).toBe("5001");
    expect(entry.targetAppId).toBe("77");
    const content = String(entry.deletionContent);
    // 一覧の取得列に無い項目（メモ）も、取り直した全項目から残る
    for (const label of ["お客様名", "施工予定日", "施工会社", "メモ"]) {
      expect(content, label).toContain(label);
    }
    expect(content).toContain("現場メモ");
  });

  it("★ 監査ログを残せなかったら削除しない", async () => {
    h.auditFails = true;

    const result = await cancel();

    expect(h.deleteCalls).toEqual([]);
    expect(h.events).toEqual(["get", "audit"]);
    expect(result.constructionDeleted).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("削除の記録を残せなかったため");
    expect(result.warnings[0]).toContain("削除していません");
  });

  it("★ 監査ログが例外を投げても削除しない（更新のときとは逆）", async () => {
    h.auditThrows = true;

    const result = await cancel();

    expect(h.deleteCalls).toEqual([]);
    expect(result.constructionDeleted).toBe(false);
    expect(result.warnings[0]).toContain("削除の記録を残せなかったため");
  });
});

describe("★ 複数一致したら削除しない", () => {
  it("★ 同じ T番号 のレコードが2件あれば削除せず、警告を出す", async () => {
    h.records = [
      caseRow(5001, { "field-101": "" }),
      caseRow(5009, { "field-101": "" }),
    ];

    const result = await cancel({});

    expect(h.deleteCalls).toEqual([]);
    expect(result.constructionDeleted).toBe(false);
    expect(result.constructionUpdated).toBe(false);
    expect(result.warnings).toEqual([
      "キャンセル処理は完了しましたが、工事登録アプリに同じ案件のレコードが複数あるため、削除を中止しました。DX事業部へ連絡してください。",
    ]);
  });

  it("★ Aki番号 と T番号 で別々のレコードが一致したら中止する", async () => {
    // Aki番号 では 5002 の1件に決まるが、同じ T番号 の 5001 が別にある
    h.records = [
      caseRow(5001, { "field-101": "A0000" }),
      caseRow(5002, { "field-1": "" }),
    ];

    const result = await cancel();

    expect(h.deleteCalls).toEqual([]);
    expect(result.constructionDeleted).toBe(false);
    expect(result.warnings[0]).toContain("複数あるため、削除を中止しました");
  });

  it("同じ Aki番号 のレコードが2件あっても中止する", async () => {
    h.records = [
      caseRow(5001, { "field-1": "" }),
      caseRow(5002, { "field-1": "" }),
    ];

    const result = await cancel();

    expect(h.deleteCalls).toEqual([]);
    expect(result.warnings[0]).toContain("複数あるため、削除を中止しました");
  });

  it("★ 中止するときは、取り直し・監査ログ・更新のどれも行わない", async () => {
    h.records = [caseRow(5001), caseRow(5009)];

    await cancel();

    expect(h.events).toEqual([]);
    expect(h.updateWrites).toEqual([]);
  });

  it("★ 警告に再試行を促す表現を含まない", async () => {
    h.records = [caseRow(5001), caseRow(5009)];

    const result = await cancel();

    for (const w of RETRY_WORDS) {
      expect(result.warnings[0], w).not.toContain(w);
    }
    expect(result.warnings[0]).toContain("DX事業部へ連絡してください");
  });

  it("無関係なレコードは件数に数えない", async () => {
    h.records = [
      caseRow(5001),
      caseRow(6001, { "field-1": "T00000001", "field-101": "A0001" }),
      caseRow(6002, { "field-1": "", "field-101": "" }),
    ];

    const result = await cancel();

    expect(result.constructionDeleted).toBe(true);
    expect(h.deleteCalls.map((d) => d.recordId)).toEqual(["5001"]);
  });
});

describe("★ 中身を確かめられないときは削除しない", () => {
  it("★ 取り直しが例外なら削除しない", async () => {
    h.getThrows = true;

    const result = await cancel();

    expect(h.deleteCalls).toEqual([]);
    expect(h.audits).toEqual([]);
    expect(result.constructionDeleted).toBe(false);
    expect(result.warnings).toEqual([
      "キャンセル処理は完了しましたが、工事登録アプリのレコードを削除できませんでした。DX事業部へ連絡してください。",
    ]);
  });

  it("取り直してレコードが返らなければ削除しない", async () => {
    h.freshById = { "5001": null };

    const result = await cancel();

    expect(h.deleteCalls).toEqual([]);
    expect(h.audits).toEqual([]);
    expect(result.warnings[0]).toContain("削除できませんでした");
  });

  it("★ 取り直したレコードが別の案件になっていたら削除しない", async () => {
    // 一覧（キャッシュ）ではこの案件だったが、その間に書き換わっていた
    h.freshById = {
      "5001": {
        "field-1": "T00000001",
        "field-2": "別の お客様",
        "field-101": "A0001",
      },
    };

    const result = await cancel();

    expect(h.deleteCalls).toEqual([]);
    expect(h.audits).toEqual([]);
    expect(result.constructionDeleted).toBe(false);
    expect(result.warnings[0]).toContain("削除できませんでした");
  });

  it("★ 削除が失敗したら警告を返す（投げない）", async () => {
    h.deleteThrows = true;

    const result = await cancel();

    expect(result.constructionDeleted).toBe(false);
    expect(result.warnings).toEqual([
      "キャンセル処理は完了しましたが、工事登録アプリのレコードを削除できませんでした。DX事業部へ連絡してください。",
    ]);
  });

  it("削除できなかったときの警告も再試行を促さない", async () => {
    const texts: string[] = [];
    h.deleteThrows = true;
    texts.push(...(await cancel()).warnings);
    h.deleteThrows = false;
    h.auditFails = true;
    texts.push(...(await cancel()).warnings);

    expect(texts).toHaveLength(2);
    for (const text of texts) {
      for (const w of RETRY_WORDS) expect(text, w).not.toContain(w);
    }
  });
});

describe("★ 工事レコードが見つからないときは従来どおり", () => {
  it("★ 警告を返し、何も消さない", async () => {
    h.records = [caseRow(6001, { "field-1": "T00000001", "field-101": "A0001" })];

    const result = await cancel();

    expect(result).toEqual({
      warnings: [
        "キャンセル処理は完了しましたが、工事登録アプリに該当レコードが見つかりませんでした。DX事業部へ連絡してください。",
      ],
      constructionUpdated: false,
      constructionDeleted: false,
    });
    expect(h.events).toEqual([]);
    expect(h.updateWrites).toEqual([]);
  });

  it("CALENDAR_APP_ID が未設定でも同じ警告", async () => {
    delete process.env.CALENDAR_APP_ID;

    const result = await cancel();

    expect(result.constructionDeleted).toBe(false);
    expect(result.warnings[0]).toContain("該当レコードが見つかりませんでした");
    expect(h.events).toEqual([]);
  });
});

describe("★ 環境変数で削除を止められる", () => {
  it("★ false のときは削除せず、3項目を空にする更新に戻る", async () => {
    process.env.CUSTOMER_CANCEL_DELETE_CONSTRUCTION_RECORD = "false";

    const result = await cancel();

    expect(h.deleteCalls).toEqual([]);
    expect(result.constructionUpdated).toBe(true);
    expect(result.constructionDeleted).toBe(false);
    expect(h.updateWrites).toHaveLength(1);
    expect(h.updateWrites[0]!.payload).toEqual({
      "field-3": "",
      "field-4": "",
      "field-6": "",
    });
  });

  it("未設定・true のときは削除する（既定は削除）", async () => {
    expect((await cancel()).constructionDeleted).toBe(true);

    process.env.CUSTOMER_CANCEL_DELETE_CONSTRUCTION_RECORD = "true";
    h.deleteCalls = [];
    expect((await cancel()).constructionDeleted).toBe(true);
  });
});

describe("★ ログに実データを出さない", () => {
  const SECRETS = [T_NUMBER, AKI_NUMBER, CUSTOMER_NAME];

  it("★ 一致件数のログは件数と真偽値だけ", async () => {
    await cancel();

    const call = infoSpy.mock.calls.find(
      (c) => c[0] === "[customer-cancel] 工事レコードの一致件数",
    );
    expect(call).toBeTruthy();
    expect(JSON.parse(String(call![1]))).toEqual({
      matchedRecords: 1,
      deleteEnabled: true,
    });
  });

  it("複数一致のとき、件数がログに残る", async () => {
    h.records = [caseRow(5001), caseRow(5009)];

    await cancel();

    expect(allLoggedText()).toContain('"matchedRecords":2');
    expect(allLoggedText()).toContain('"reason":"ambiguous"');
  });

  it("★ 削除・中止・失敗のどの経路でも、氏名・T番号・Aki番号 がログに出ない", async () => {
    await cancel();
    h.records = [caseRow(5001), caseRow(5009)];
    await cancel();
    h.records = [caseRow(5001)];
    h.deleteThrows = true;
    await cancel();
    h.deleteThrows = false;
    h.auditFails = true;
    await cancel();

    const logged = allLoggedText();
    for (const secret of SECRETS) expect(logged, secret).not.toContain(secret);
  });
});
