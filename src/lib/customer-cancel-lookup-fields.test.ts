import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * キャンセル時の工事レコード照合で、**取得列と照合列を揃える**。
 *
 * 以前は取得列を fids（見出しから解決した17項目）だけで作っていた。
 *   - Aki番号 … 照合には使うが、fids に無いので取得列に入っていなかった
 *   - T番号  … 照合列は環境変数を優先、取得列は見出し「T番号」から解決
 * @pocket が指定列だけを返すなら、その列での照合は一度も成立しない。
 *
 * 既存の customer-cancel-empty-slot.test.ts は一覧のモックが取得列を
 * 無視するため、このずれを検出できなかった。ここでは**指定した列だけを
 * 返す**一覧で確かめる。
 *
 * あわせて、どちらの列で一致したかの診断ログを固定する。
 * 出してよいのは件数と真偽値だけ。
 */

const T_NUMBER = "T99990001";
const AKI_NUMBER = "A9001";
const CUSTOMER_NAME = "試験 太郎";

const BASE_FIELDS = [
  { uniqueId: "field-1", caption: "T番号" },
  { uniqueId: "field-2", caption: "お客様名" },
  { uniqueId: "field-3", caption: "施工予定日" },
  { uniqueId: "field-4", caption: "施工会社" },
  { uniqueId: "field-6", caption: "工事対応者" },
];
const AKI_FIELD = { uniqueId: "field-101", caption: "Aki番号" };
/** 環境変数で T番号 の照合列として指す、見出しが「T番号」ではない列 */
const ALT_T_FIELD = { uniqueId: "field-50", caption: "案件番号" };

type Row = { recordId: number; record: Record<string, unknown> };

const h = vi.hoisted(() => ({
  fields: [] as { uniqueId: string; caption: string }[],
  records: [] as { recordId: number; record: Record<string, unknown> }[],
  listCsvs: [] as string[],
  writes: [] as { recordId?: string }[],
}));

vi.mock("@/lib/atpocket", () => ({
  apiKeyForCalendarPocket1: () => "read-key",
  apiKeyForCalendarWrite: () => "write-key",
  fetchAppFields: async () => h.fields,
  createRecord: async () => ({
    row: { recordId: 9001 },
    location: null,
    recordIdHint: "9001",
    rawBody: null,
  }),
}));

vi.mock("@/lib/atpocket-write-with-import-key", () => ({
  writePocketRecordWithImportKey: async (opts: { recordId?: string }) => {
    h.writes.push({ recordId: opts.recordId });
    return undefined;
  },
}));

vi.mock("@/lib/calendar-construction-records-cache", () => ({
  /** **指定した列だけ**を返す。取得列に無い列は行から落とす */
  fetchCalendarConstructionRecordsCached: async (
    _appId: string,
    fieldsCsv: string,
  ) => {
    h.listCsvs.push(fieldsCsv);
    const allowed = new Set(fieldsCsv.split(","));
    return h.records.map((row) => ({
      recordId: row.recordId,
      record: Object.fromEntries(
        Object.entries(row.record).filter(([k]) => allowed.has(k)),
      ),
    }));
  },
  invalidateCalendarConstructionRecordsCache: () => {},
}));

vi.mock("@/lib/calendar-response-cache", () => ({
  invalidateAllCalendarPayloadCache: () => {},
}));

vi.mock("@/lib/audit-log", () => ({
  auditLogEnabled: () => true,
  recordAuditLog: async () => ({ ok: true, written: 1 }),
}));

const { runCustomerCancelSideEffects } = await import(
  "@/lib/customer-cancel-server"
);

/** 列の解決に効く環境変数。テストの外の設定を持ち込まない */
const ENV_KEYS = [
  "CALENDAR_APP_ID",
  "CUSTOMER_CANCEL_DELETE_CONSTRUCTION_RECORD",
  "CALENDAR_CONSTRUCTION_IMPORT_KEY_FIELD_ID",
  "CALENDAR_CONSTRUCTION_UNIQUE_KEY_FIELD_ID",
  "CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID",
  "CALENDAR_CONTRACTOR_FIELD_ID",
  "CALENDAR_START_DATE_FIELD_ID",
  "CALENDAR_SHIGUMI_DATE_FIELD_ID",
  "CALENDAR_PANEL_WORK_DATE_FIELD_ID",
  "CALENDAR_ELECTRIC_WORK_DATE_FIELD_ID",
  "CALENDAR_APP_SETTINGS_DATE_FIELD_ID",
  "CALENDAR_EMPTY_FILL_CONSTRUCTION_HANDLER_FIELD_ID",
  "CALENDAR_EMPTY_FILL_CONSTRUCTION_REGISTRANT_FIELD_ID",
  "CALENDAR_CUSTOMER_STATUS_FIELD_ID",
] as const;
const savedEnv: Record<string, string | undefined> = {};

let infoSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.CALENDAR_APP_ID = "77";
  /**
   * ここは**照合だけ**を見る。どのレコードに当たったかは、従来の更新
   * （3項目を空にする）の書き込み先で観測しているので、削除は止めておく。
   * 照合は削除する・しないの分岐より前にあり、どちらでも同じものが走る。
   * 削除の経路は customer-cancel-delete.test.ts が見ている
   */
  process.env.CUSTOMER_CANCEL_DELETE_CONSTRUCTION_RECORD = "false";
  h.fields = [...BASE_FIELDS, AKI_FIELD];
  h.records = [];
  h.listCsvs = [];
  h.writes = [];
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

/** ここは照合だけを見る */
function cancel(extra: { akiNumber?: string } = {}) {
  return runCustomerCancelSideEffects({
    tNumber: T_NUMBER,
    lineUserId: "U-test",
    ...extra,
  });
}

function requestedColumns(): string[] {
  expect(h.listCsvs).toHaveLength(1);
  return h.listCsvs[0]!.split(",");
}

const DIAG_LABEL = "[customer-cancel] 工事レコードの照合内訳";

function diagnostics(): Record<string, unknown> {
  const call = infoSpy.mock.calls.find((c) => c[0] === DIAG_LABEL);
  expect(call, "診断ログが出ていない").toBeTruthy();
  return JSON.parse(String(call![1])) as Record<string, unknown>;
}

function allLoggedText(): string {
  return [infoSpy, warnSpy, errorSpy]
    .flatMap((spy) => spy.mock.calls)
    .map((c) => c.map((x) => String(x)).join(" "))
    .join("\n");
}

const caseRow = (id: number, record: Record<string, unknown>): Row => ({
  recordId: id,
  record: { "field-2": CUSTOMER_NAME, "field-3": "2026-12-01", ...record },
});

describe("★ 取得列に照合列が含まれる", () => {
  it("★ Aki番号 の列が取得列に含まれる", async () => {
    await cancel({ akiNumber: AKI_NUMBER });

    expect(requestedColumns()).toContain("field-101");
  });

  it("★ 照合に使う T番号 の列が取得列に含まれる（見出しから解決）", async () => {
    await cancel();

    expect(requestedColumns()).toContain("field-1");
  });

  it("★ T番号 の照合列を環境変数で指しているとき、その列が取得列に含まれる", async () => {
    h.fields = [...BASE_FIELDS, AKI_FIELD, ALT_T_FIELD];
    process.env.CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID = "field-50";

    await cancel();

    expect(requestedColumns()).toContain("field-50");
  });

  it("従来の取得列（施工予定日・施工会社・工事対応者など）は減っていない", async () => {
    await cancel();

    const cols = requestedColumns();
    for (const id of ["field-1", "field-2", "field-3", "field-4", "field-6"]) {
      expect(cols, id).toContain(id);
    }
  });

  it("同じ列を二重に指定しない", async () => {
    await cancel({ akiNumber: AKI_NUMBER });

    const cols = requestedColumns();
    expect(new Set(cols).size).toBe(cols.length);
  });
});

describe("★ 指定した列しか返らなくても照合できる", () => {
  it("★ T番号 が未転記の工事レコードを Aki番号 で引ける", async () => {
    h.records = [caseRow(5002, { "field-101": AKI_NUMBER })];

    const result = await cancel({ akiNumber: AKI_NUMBER });

    expect(result.constructionUpdated).toBe(true);
    expect(h.writes).toEqual([{ recordId: "5002" }]);
  });

  it("★ 環境変数で指した T番号 列で引ける", async () => {
    h.fields = [...BASE_FIELDS, AKI_FIELD, ALT_T_FIELD];
    process.env.CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID = "field-50";
    h.records = [caseRow(5003, { "field-50": T_NUMBER })];

    const result = await cancel();

    expect(result.constructionUpdated).toBe(true);
    expect(h.writes).toEqual([{ recordId: "5003" }]);
  });

  it("照合の順序は変えていない（Aki番号 → T番号）", async () => {
    h.records = [
      caseRow(5001, { "field-1": T_NUMBER }),
      caseRow(5002, { "field-101": AKI_NUMBER }),
    ];

    await cancel({ akiNumber: AKI_NUMBER });

    expect(h.writes).toEqual([{ recordId: "5002" }]);
  });
});

describe("★ 照合列を解決できないときは取得列にも足さない", () => {
  it("★ Aki番号 の列が無いアプリでは、取得列に足されない", async () => {
    h.fields = [...BASE_FIELDS];
    h.records = [caseRow(5001, { "field-1": T_NUMBER })];

    const result = await cancel({ akiNumber: AKI_NUMBER });

    const cols = requestedColumns();
    expect(cols).not.toContain("field-101");
    expect(cols.every((c) => c.trim() !== "")).toBe(true);
    // 照合の対象から外れるだけで、T番号 では従来どおり引ける
    expect(result.constructionUpdated).toBe(true);
    expect(diagnostics()).toMatchObject({ matchedBy: "tNumber" });
  });

  it("環境変数が存在しない列を指しているとき、Aki番号 は取得列に足されない", async () => {
    process.env.CALENDAR_CONSTRUCTION_IMPORT_KEY_FIELD_ID = "field-999";
    h.records = [caseRow(5001, { "field-1": T_NUMBER })];

    await cancel({ akiNumber: AKI_NUMBER });

    const cols = requestedColumns();
    expect(cols).not.toContain("field-999");
    expect(cols).not.toContain("field-101");
  });
});

describe("★ 診断ログ", () => {
  it("★ Aki番号 で一致したら matchedBy は aki", async () => {
    h.records = [caseRow(5002, { "field-101": AKI_NUMBER })];

    await cancel({ akiNumber: AKI_NUMBER });

    expect(diagnostics()).toEqual({
      matchedBy: "aki",
      akiProvided: true,
      rowsWithAkiKey: 1,
      rowsTotal: 1,
      tNumberInFields: true,
    });
  });

  it("★ T番号 で一致したら matchedBy は tNumber", async () => {
    h.records = [caseRow(5001, { "field-1": T_NUMBER })];

    await cancel();

    expect(diagnostics()).toEqual({
      matchedBy: "tNumber",
      akiProvided: false,
      rowsWithAkiKey: 0,
      rowsTotal: 1,
      tNumberInFields: true,
    });
  });

  it("★ Aki番号 を渡していても、T番号 でしか当たらなければ tNumber", async () => {
    h.records = [caseRow(5001, { "field-1": T_NUMBER, "field-101": "A0000" })];

    await cancel({ akiNumber: AKI_NUMBER });

    expect(diagnostics()).toMatchObject({
      matchedBy: "tNumber",
      akiProvided: true,
      rowsWithAkiKey: 1,
    });
  });

  it("★ どちらでも一致しなければ matchedBy は none", async () => {
    h.records = [caseRow(5009, { "field-1": "T00000000" })];

    const result = await cancel({ akiNumber: AKI_NUMBER });

    expect(result.constructionUpdated).toBe(false);
    expect(diagnostics()).toMatchObject({ matchedBy: "none", rowsTotal: 1 });
  });

  it("rowsWithAkiKey は Aki番号 のキーを持つ行だけを数える（値が空でも数える）", async () => {
    h.records = [
      caseRow(5001, { "field-1": T_NUMBER }),
      caseRow(5002, { "field-101": "A0001" }),
      caseRow(5003, { "field-101": "" }),
    ];

    await cancel();

    expect(diagnostics()).toMatchObject({ rowsWithAkiKey: 2, rowsTotal: 3 });
  });

  it("★ 出すのは件数と真偽値だけ（決めた5項目以外を出さない）", async () => {
    h.records = [caseRow(5002, { "field-101": AKI_NUMBER })];

    await cancel({ akiNumber: AKI_NUMBER });

    const diag = diagnostics();
    expect(Object.keys(diag).sort()).toEqual(
      [
        "akiProvided",
        "matchedBy",
        "rowsTotal",
        "rowsWithAkiKey",
        "tNumberInFields",
      ].sort(),
    );
    expect(["aki", "tNumber", "none"]).toContain(diag.matchedBy);
    expect(typeof diag.akiProvided).toBe("boolean");
    expect(typeof diag.tNumberInFields).toBe("boolean");
    expect(typeof diag.rowsWithAkiKey).toBe("number");
    expect(typeof diag.rowsTotal).toBe("number");
  });
});

describe("★ ログに実データを出さない", () => {
  const SECRETS = [T_NUMBER, AKI_NUMBER, CUSTOMER_NAME];

  it("★ 一致したとき、氏名・T番号・Aki番号 がどのログにも出ない", async () => {
    h.records = [
      caseRow(5002, { "field-1": T_NUMBER, "field-101": AKI_NUMBER }),
    ];

    await cancel({ akiNumber: AKI_NUMBER });

    const logged = allLoggedText();
    for (const secret of SECRETS) expect(logged, secret).not.toContain(secret);
  });

  it("★ 見つからなかったときのログにも T番号 の値が出ない", async () => {
    h.records = [caseRow(5009, { "field-1": "T00000000" })];

    await cancel({ akiNumber: AKI_NUMBER });

    const logged = allLoggedText();
    // 見つからなかったことは残る
    expect(logged).toContain("該当レコードが無い");
    for (const secret of SECRETS) expect(logged, secret).not.toContain(secret);
    expect(logged).toContain('"hasTNumber":true');
  });
});
