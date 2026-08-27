import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * お客様情報で施工予定日を入れたときの工事登録アプリ連携（第2段階）。
 *
 * 第1段階で、施工予定日が未定の新規登録は工事登録アプリに作らなくなった。
 * その案件の日程が決まったらここで工事側へ載せる。
 *
 * ここで固定するのは次の4つ。
 *   - 既存レコードは T番号 で引く（Aki番号 は第1段階のレコードに無い）
 *   - **探せなかったときは作らない**（二重に作ると実データを壊す）
 *   - 書き込むのは5項目だけ
 *   - 新規作成では取込キー（Aki番号）を空文字で載せ、採番値を返す
 */

const h = vi.hoisted(() => ({
  /** T番号 → 一覧の応答 */
  listRows: [] as unknown[],
  listCalls: [] as { query?: string }[],
  listThrows: false,
  writes: [] as { recordId?: string; payload: Record<string, unknown> }[],
  auditOps: [] as string[],
  akiOnCreate: "A0007" as string | null,
}));

const FIELDS = [
  { uniqueId: "field-1", caption: "T番号" },
  { uniqueId: "field-101", caption: "Aki番号" },
  { uniqueId: "field-2", caption: "お客様名" },
  { uniqueId: "field-3", caption: "施工予定日" },
  { uniqueId: "field-4", caption: "施工会社" },
  { uniqueId: "field-5", caption: "住宅ステータス" },
  { uniqueId: "field-6", caption: "工事対応者" },
];

vi.mock("@/lib/atpocket", () => ({
  apiKeyForCalendarPocket1: () => "read-key",
  apiKeyForCalendarWrite: () => "write-key",
  fetchAppFields: async () => FIELDS,
  fetchRecordsList: async (
    _appId: string,
    params?: { query?: string },
  ) => {
    h.listCalls.push({ query: params?.query });
    if (h.listThrows) throw new Error("429 Too Many Requests");
    return { records: h.listRows };
  },
}));

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
      : { recordIdHint: "con-new", row: null, location: null };
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

vi.mock("@/lib/calendar-response-cache", () => ({
  invalidateAllCalendarPayloadCache: () => {},
}));

vi.mock("@/lib/audit-log", () => ({
  recordAuditLog: async (e: { operation: string }) => {
    h.auditOps.push(e.operation);
    return { ok: true };
  },
}));

const { linkCustomerInfoToConstruction } = await import(
  "@/lib/customer-info-construction-link"
);

const BASE = {
  tNumber: "T00003420",
  customerName: "山田 太郎",
  housingStatus: "既築案件",
  constructionDate: "2026-12-01",
  contractor: "ピュアライフ",
  constructionHandler: "西村 直也",
  lineUserId: "U1",
};

const row = (id: number, rec: Record<string, unknown>) => ({
  recordId: id,
  record: rec,
});

beforeEach(() => {
  process.env.CALENDAR_APP_ID = "app-con";
  delete process.env.CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID;
  delete process.env.CALENDAR_EMPTY_FILL_TITLE_FIELD_ID;
  h.listRows = [];
  h.listCalls = [];
  h.listThrows = false;
  h.writes = [];
  h.auditOps = [];
  h.akiOnCreate = "A0007";
});

describe("★ 既存レコードが無いとき（新規作成）", () => {
  it("工事登録アプリに作成する", async () => {
    const res = await linkCustomerInfoToConstruction(BASE);

    expect(res).toMatchObject({ kind: "created", recordId: "con-new" });
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]?.recordId).toBeUndefined();
  });

  it("★ 取込キー（Aki番号）を空文字で載せる", async () => {
    await linkCustomerInfoToConstruction(BASE);

    expect(h.writes[0]?.payload).toHaveProperty("field-101", "");
  });

  it("★ T番号 を転記する（テキスト型）", async () => {
    await linkCustomerInfoToConstruction(BASE);

    expect(h.writes[0]?.payload).toHaveProperty("field-1", "T00003420");
  });

  it("★ 採番された Aki番号 を返す（お客様情報へ書き戻すため）", async () => {
    const res = await linkCustomerInfoToConstruction(BASE);

    expect(res).toMatchObject({ akiNumber: "A0007" });
  });

  it("監査ログに作成が記録される", async () => {
    await linkCustomerInfoToConstruction(BASE);

    expect(h.auditOps).toEqual(["create"]);
  });
});

describe("★ 既存レコードがあるとき（更新）", () => {
  beforeEach(() => {
    h.listRows = [
      row(55, { "field-1": "T00003420", "field-101": "A0001" }),
    ];
  });

  it("更新する（新規作成しない）", async () => {
    const res = await linkCustomerInfoToConstruction(BASE);

    expect(res).toEqual({ kind: "updated", recordId: "55" });
    expect(h.writes[0]?.recordId).toBe("55");
  });

  it("★ T番号 で引く", async () => {
    await linkCustomerInfoToConstruction(BASE);

    expect(h.listCalls[0]?.query).toContain("T00003420");
    expect(h.listCalls[0]?.query).toContain("field-1");
  });

  it("既存の Aki番号 を同送する（取込キー）", async () => {
    await linkCustomerInfoToConstruction(BASE);

    expect(h.writes[0]?.payload).toHaveProperty("field-101", "A0001");
  });

  it("★ 更新では T番号 を上書きしない", async () => {
    await linkCustomerInfoToConstruction(BASE);

    expect(h.writes[0]?.payload).not.toHaveProperty("field-1");
  });

  it("Aki番号 が無い既存レコード（第1段階のもの）でも更新できる", async () => {
    h.listRows = [row(55, { "field-1": "T00003420" })];

    const res = await linkCustomerInfoToConstruction(BASE);

    expect(res).toEqual({ kind: "updated", recordId: "55" });
  });

  it("監査ログに更新が記録される", async () => {
    await linkCustomerInfoToConstruction(BASE);

    expect(h.auditOps).toEqual(["update"]);
  });
});

describe("★ 書き込む項目は5つだけ", () => {
  it("住宅ステータス・お客様名・施工予定日・施工会社・工事対応者", async () => {
    h.listRows = [row(55, { "field-1": "T00003420", "field-101": "A0001" })];

    await linkCustomerInfoToConstruction(BASE);

    // 取込キー（Aki番号）は @pocket の作法で必要なので別枠
    expect(Object.keys(h.writes[0]!.payload).sort()).toEqual(
      [
        "field-101",
        "field-2",
        "field-3",
        "field-4",
        "field-5",
        "field-6",
      ].sort(),
    );
  });

  it("★ 工事対応者を転記する", async () => {
    h.listRows = [row(55, { "field-1": "T00003420" })];

    await linkCustomerInfoToConstruction(BASE);

    expect(h.writes[0]?.payload).toHaveProperty("field-6", "西村 直也");
  });

  it("★ 新規作成でも工事対応者を載せる", async () => {
    await linkCustomerInfoToConstruction(BASE);

    expect(h.writes[0]?.payload).toHaveProperty("field-6", "西村 直也");
  });

  it("値が空の項目は載せない（既存値を消さない）", async () => {
    h.listRows = [row(55, { "field-1": "T00003420" })];

    await linkCustomerInfoToConstruction({
      ...BASE,
      contractor: "",
      housingStatus: "",
      constructionHandler: "",
    });

    expect(h.writes[0]?.payload).not.toHaveProperty("field-4");
    expect(h.writes[0]?.payload).not.toHaveProperty("field-5");
    expect(h.writes[0]?.payload).not.toHaveProperty("field-6");
    // 施工予定日は必ず載る（これがトリガーなので）
    expect(h.writes[0]?.payload).toHaveProperty("field-3", "2026-12-01");
  });
});

describe("★ 誤特定を避ける", () => {
  it("★ 検索に失敗したら作らない（二重登録を防ぐ）", async () => {
    h.listThrows = true;

    const res = await linkCustomerInfoToConstruction(BASE);

    expect(res.kind).toBe("failed");
    expect(h.writes).toHaveLength(0);
  });

  it("★ 同じ T番号 が複数ヒットしたら触らない", async () => {
    h.listRows = [
      row(55, { "field-1": "T00003420" }),
      row(56, { "field-1": "T00003420" }),
    ];

    const res = await linkCustomerInfoToConstruction(BASE);

    expect(res.kind).toBe("failed");
    expect(h.writes).toHaveLength(0);
  });

  it("T番号 が一致しない行は拾わない（前方一致などで掴まない）", async () => {
    h.listRows = [row(55, { "field-1": "T000034200" })];

    const res = await linkCustomerInfoToConstruction(BASE);

    // 一致しないので新規作成になる
    expect(res.kind).toBe("created");
  });
});

describe("★ 触らない条件", () => {
  it("CALENDAR_APP_ID 未設定なら何もしない", async () => {
    delete process.env.CALENDAR_APP_ID;

    const res = await linkCustomerInfoToConstruction(BASE);

    expect(res).toMatchObject({ kind: "skipped" });
    expect(h.writes).toHaveLength(0);
  });

  it("T番号 が無ければ何もしない（突き合わせられない）", async () => {
    const res = await linkCustomerInfoToConstruction({ ...BASE, tNumber: "" });

    expect(res).toMatchObject({ kind: "skipped" });
    expect(h.listCalls).toHaveLength(0);
    expect(h.writes).toHaveLength(0);
  });

  it("施工予定日が空なら何もしない（レコードも消さない）", async () => {
    const res = await linkCustomerInfoToConstruction({
      ...BASE,
      constructionDate: "",
    });

    expect(res).toMatchObject({ kind: "skipped" });
    expect(h.writes).toHaveLength(0);
  });

  it("施工予定日の形式が違えば何もしない", async () => {
    const res = await linkCustomerInfoToConstruction({
      ...BASE,
      constructionDate: "2026/12/01",
    });

    expect(res).toMatchObject({ kind: "skipped" });
    expect(h.writes).toHaveLength(0);
  });
});
