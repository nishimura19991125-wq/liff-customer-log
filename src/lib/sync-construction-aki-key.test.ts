import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T番号の採番元が入れ替わった件の連携テスト。
 *
 *   変更前  工事登録で採番 → お客様情報へ転記
 *   変更後  お客様情報で採番 → 工事登録へ転記
 *
 * 順序（工事 → 顧客）は変えていない。変えたのは
 *   - 突合キー: T番号 → Aki番号
 *   - T番号: 書き込む → 読み取って返す
 * の2点。
 *
 * ここで固定するのは次の4つ。
 *   - T番号 の列は**新規作成のときだけ空文字で載せる**（@pocket が採番する）。
 *     更新では載せない（既存の採番値を消さないため）
 *   - 突合は Aki番号 で行う
 *   - Aki番号 が空の既存レコードは T番号 で拾う（二重登録を防ぐ）
 *   - 採番された T番号 を返す
 */

const h = vi.hoisted(() => ({
  /** お客様情報アプリのレコード（recordId → 中身） */
  customerRecords: {} as Record<string, Record<string, unknown>>,
  /** キー照合の結果。fieldId ごとに value → recordId */
  lookup: {} as Record<string, Record<string, string>>,
  lookupCalls: [] as { fieldId: string; value: string }[],
  created: [] as Record<string, unknown>[],
  updated: [] as { recordId: string; payload: Record<string, unknown> }[],
  /** 工事アプリのレコード */
  constructionRecord: {} as Record<string, unknown>,
}));

const CUSTOMER_FIELDS = [
  { uniqueId: "field-268", caption: "T番号" },
  { uniqueId: "field-267", caption: "Aki番号" },
  { uniqueId: "field-2", caption: "お客様名" },
  { uniqueId: "field-5", caption: "住宅ステータス" },
];

const CONSTRUCTION_FIELDS = [
  { uniqueId: "field-1", caption: "T番号" },
  { uniqueId: "field-101", caption: "Aki番号" },
  { uniqueId: "field-2", caption: "お客様名" },
  { uniqueId: "field-5", caption: "住宅ステータス" },
];

vi.mock("@/lib/atpocket", () => ({
  apiKeyForCustomerInfoWrite: () => "customer-write",
  fetchAppFields: async () => CUSTOMER_FIELDS,
  fetchRecordById: async (_appId: string, recordId: string) => {
    if (recordId === "con-1") return { record: h.constructionRecord };
    const rec = h.customerRecords[recordId];
    return rec ? { record: rec } : null;
  },
  createRecord: async (_appId: string, payload: Record<string, unknown>) => {
    h.created.push(payload);
    // @pocket が T番号 を採番する
    h.customerRecords["cust-new"] = { ...payload, "field-268": "T00003420" };
    return { recordIdHint: "cust-new", row: null, location: null };
  },
  updateRecord: async (
    _appId: string,
    recordId: string,
    payload: Record<string, unknown>,
  ) => {
    h.updated.push({ recordId, payload });
  },
}));

vi.mock("@/lib/customer-info-key-lookup-cache", () => ({
  findCustomerInfoRecordIdByUniqueKeyCached: async (
    fieldId: string,
    value: string,
  ) => {
    h.lookupCalls.push({ fieldId, value });
    return h.lookup[fieldId]?.[value] ?? null;
  },
  refetchCustomerInfoRecordIdByUniqueKey: async (
    fieldId: string,
    value: string,
  ) => h.lookup[fieldId]?.[value] ?? null,
}));

vi.mock("@/lib/dropbox", () => ({ dropboxConfigured: () => false }));
vi.mock("@/lib/audit-log", () => ({
  auditLogEnabled: () => false,
  recordAuditLog: async () => ({ ok: true }),
}));

const { syncConstructionRecordToCustomerInfoApp } = await import(
  "@/lib/sync-construction-to-customer-info"
);

function sync(over: Record<string, unknown> = {}) {
  return syncConstructionRecordToCustomerInfoApp({
    calAppId: "app-con",
    constructionRecordId: "con-1",
    customerName: "山田 太郎",
    housingStatus: "既築案件",
    constructionFields: CONSTRUCTION_FIELDS,
    calendarAuth: { apiKey: "cal" },
    ...over,
  });
}

beforeEach(() => {
  process.env.CUSTOMER_INFO_APP_ID = "app-cust";
  process.env.CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID = "field-268";
  process.env.CUSTOMER_INFO_AKI_NUMBER_FIELD_ID = "field-267";
  process.env.CUSTOMER_INFO_CUSTOMER_NAME_FIELD_ID = "field-2";
  h.customerRecords = {};
  h.lookup = {};
  h.lookupCalls = [];
  h.created = [];
  h.updated = [];
  // 新規案件: Aki番号 は入っているが T番号 はまだ無い
  h.constructionRecord = { "field-101": "A0001", "field-2": "山田 太郎" };
});

describe("★ 新規作成", () => {
  it("★ T番号 の列を空文字で載せる（@pocket が採番する）", async () => {
    /*
     * 「値を送らない」と「列を載せない」は別物。
     * 列ごと外すと @pocket が 400 を返す
     *   キー項目「T番号」が取込設定に存在しないため登録できません
     */
    await sync();

    expect(h.created).toHaveLength(1);
    expect(h.created[0]).toHaveProperty("field-268", "");
  });

  it("採番済みの値を送りつけない（空文字であること）", async () => {
    await sync();

    expect(h.created[0]!["field-268"]).toBe("");
  });

  it("★ Aki番号 を書き込む（次回以降の突合キーになる）", async () => {
    await sync();

    expect(JSON.stringify(h.created[0]!["field-267"])).toContain("A0001");
  });

  it("★ 採番された T番号 を返す", async () => {
    const res = await sync();

    expect(res).toMatchObject({ kind: "synced", tNumber: "T00003420" });
  });

  it("突合は Aki番号 で行う", async () => {
    await sync();

    expect(h.lookupCalls[0]).toEqual({ fieldId: "field-267", value: "A0001" });
  });
});

describe("★ 既存レコードの更新", () => {
  it("Aki番号 が一致すれば更新する（作成しない）", async () => {
    h.lookup["field-267"] = { A0001: "cust-9" };
    h.customerRecords["cust-9"] = { "field-268": "T00001111" };

    const res = await sync();

    expect(h.created).toHaveLength(0);
    expect(h.updated[0]?.recordId).toBe("cust-9");
    expect(res).toMatchObject({ tNumber: "T00001111" });
  });

  it("★ Aki番号 が空の既存レコードは T番号 で拾う（二重登録を防ぐ）", async () => {
    // 移行前からある案件: 工事側に T番号 があり、顧客側に Aki番号 が無い
    h.constructionRecord = { "field-1": "T00002222", "field-2": "山田 太郎" };
    h.lookup["field-268"] = { T00002222: "cust-old" };
    h.customerRecords["cust-old"] = { "field-268": "T00002222" };

    const res = await sync();

    // 新しく作らずに既存を更新する
    expect(h.created).toHaveLength(0);
    expect(h.updated[0]?.recordId).toBe("cust-old");
    expect(res).toMatchObject({ kind: "synced" });
  });

  it("★ 拾った既存レコードに Aki番号 を書き込む（次回は Aki で引ける）", async () => {
    h.constructionRecord = {
      "field-1": "T00002222",
      "field-101": "A0009",
      "field-2": "山田 太郎",
    };
    h.lookup["field-268"] = { T00002222: "cust-old" };
    h.customerRecords["cust-old"] = { "field-268": "T00002222" };

    await sync();

    expect(JSON.stringify(h.updated[0]?.payload["field-267"])).toContain(
      "A0009",
    );
  });

  it("★ 更新では T番号 を載せない（採番済みの値を消さない）", async () => {
    h.lookup["field-267"] = { A0001: "cust-9" };
    h.customerRecords["cust-9"] = { "field-268": "T00001111" };

    await sync();

    // 空文字を送ると既に入っている T番号 を消しかねない
    expect(h.updated[0]?.payload).not.toHaveProperty("field-268");
  });
});

describe("★ キーが無いとき", () => {
  it("Aki番号 も T番号 も取れなければ失敗を返す", async () => {
    h.constructionRecord = { "field-2": "山田 太郎" };

    const res = await sync();

    expect(res.kind).toBe("failed");
    expect(h.created).toHaveLength(0);
  });

  it("CUSTOMER_INFO_APP_ID 未設定なら何もしない", async () => {
    delete process.env.CUSTOMER_INFO_APP_ID;

    const res = await sync();

    expect(res).toEqual({ kind: "skipped" });
    expect(h.created).toHaveLength(0);
  });
});

describe("★ customerInfoOnly（施工予定日が未定・工事レコードが無い）", () => {
  function syncOnly(over: Record<string, unknown> = {}) {
    return syncConstructionRecordToCustomerInfoApp({
      calAppId: "app-con",
      customerInfoOnly: true,
      customerName: "山田 太郎",
      housingStatus: "既築案件",
      ...over,
    });
  }

  it("★ 工事アプリを一切読まない（レコード・列定義とも）", async () => {
    // fetchRecordById のモックは con-1 だけを返す。呼ばれていないことを
    // 「工事側の値が payload に出てこない」ことで確かめる
    await syncOnly();

    expect(h.created).toHaveLength(1);
    expect(h.created[0]).not.toHaveProperty("field-267");
  });

  it("★ 必ず新規作成になる（突合キーが無いため更新しない）", async () => {
    // 同じ顧客名の既存レコードがあっても拾わない
    h.lookup["field-268"] = { T00002222: "cust-old" };
    h.lookup["field-267"] = { A0001: "cust-9" };

    await syncOnly();

    expect(h.created).toHaveLength(1);
    expect(h.updated.filter((u) => u.recordId !== "cust-new")).toHaveLength(0);
  });

  it("★ Aki番号 は空のまま（採番されていないため）", async () => {
    await syncOnly();

    expect(h.created[0]).not.toHaveProperty("field-267");
  });

  it("★ T番号 の列は空文字で載せる（お客様情報側で採番される）", async () => {
    await syncOnly();

    expect(h.created[0]).toHaveProperty("field-268", "");
  });

  it("★ 採番された T番号 を返す", async () => {
    const res = await syncOnly();

    expect(res).toMatchObject({ kind: "synced", tNumber: "T00003420" });
  });

  it("お客様名・住宅ステータスは載せる", async () => {
    await syncOnly();

    expect(h.created[0]!["field-2"]).toBe("山田 太郎");
    expect(h.created[0]!["field-5"]).toBe("既築案件");
  });

  it("突合の照合そのものを行わない（@pocket を無駄に叩かない）", async () => {
    await syncOnly();

    expect(h.lookupCalls).toHaveLength(0);
  });

  it("CUSTOMER_INFO_APP_ID 未設定なら何もしない", async () => {
    delete process.env.CUSTOMER_INFO_APP_ID;

    const res = await syncOnly();

    expect(res).toEqual({ kind: "skipped" });
    expect(h.created).toHaveLength(0);
  });
});
