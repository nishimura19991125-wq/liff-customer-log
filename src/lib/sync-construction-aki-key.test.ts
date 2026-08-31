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
  /** キャッシュを捨てて引き直した回数（B案の防御が働いたか） */
  refetchCalls: [] as { fieldId: string; value: string }[],
  created: [] as Record<string, unknown>[],
  updated: [] as { recordId: string; payload: Record<string, unknown> }[],
  /** 工事アプリのレコード */
  constructionRecord: {} as Record<string, unknown>,
  /** お客様情報アプリの GET 回数（採番待ちの往復数を数える） */
  customerGetCount: 0,
  /** createRecord が recordId を返すか（実機では返らないことがある） */
  createReturnsId: true,
  /** 一覧照合の応答を呼ばれた順に返す */
  listQueue: [] as unknown[],
  listCalls: [] as (string | undefined)[],
  /**
   * 作成後にだけ照合が当たる（作成前はまだレコードが無い）。
   * 作成前に当たってしまうと更新経路へ入り、作成の検証にならない
   */
  lookupAfterCreateOnly: false,
  /**
   * この回数までは T番号 を空で返す（@pocket の採番が間に合わない状況）。
   * 0 なら1回目から採番済み。
   */
  tNumberEmptyUntil: 0,
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
    if (!rec) return null;
    h.customerGetCount += 1;
    // 採番が間に合っていない間は T番号 が空で返る
    if (h.customerGetCount <= h.tNumberEmptyUntil) {
      return { record: { ...rec, "field-268": "" } };
    }
    return { record: rec };
  },
  createRecord: async (_appId: string, payload: Record<string, unknown>) => {
    h.created.push(payload);
    // @pocket が T番号 を採番する
    h.customerRecords["cust-new"] = { ...payload, "field-268": "T00003420" };
    return h.createReturnsId
      ? { recordIdHint: "cust-new", row: null, location: null }
      : // 実機では ID を返さないことがある（location も本文も空）
        { recordIdHint: null, row: null, location: null };
  },
  fetchRecordsList: async (
    _appId: string,
    params?: { query?: string },
  ) => {
    h.listCalls.push(params?.query);
    return h.listQueue.shift() ?? { records: [] };
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
    if (h.lookupAfterCreateOnly && h.created.length === 0) return null;
    return h.lookup[fieldId]?.[value] ?? null;
  },
  refetchCustomerInfoRecordIdByUniqueKey: async (
    fieldId: string,
    value: string,
  ) => {
    h.refetchCalls.push({ fieldId, value });
    if (h.lookupAfterCreateOnly && h.created.length === 0) return null;
    return h.lookup[fieldId]?.[value] ?? null;
  },
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
  h.refetchCalls = [];
  h.created = [];
  h.updated = [];
  h.customerGetCount = 0;
  h.tNumberEmptyUntil = 0;
  h.createReturnsId = true;
  h.listQueue = [];
  h.listCalls = [];
  h.lookupAfterCreateOnly = false;
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

  /**
   * 以前ここは「更新では T番号 を載せない」を固定していた。
   * 実機で @pocket が
   *   update record failed: 400
   *   キー項目「T番号」が取込設定に存在しないため登録できません。
   * を返したので、載せる側へ直した。取込キーの列は作成だけでなく
   * 更新でも本文に要る。
   *
   * ただし**空文字ではなく読み取った実際の値**を載せる。空文字だと
   * 採番済みの T番号 を消しかねない、という元の懸念はそのまま生きている。
   */
  it("★ 更新では読み取った実際の T番号 を載せる（400 対策）", async () => {
    h.lookup["field-267"] = { A0001: "cust-9" };
    h.customerRecords["cust-9"] = { "field-268": "T00001111" };

    await sync();

    expect(h.updated[0]?.payload["field-268"]).toBe("T00001111");
  });

  it("★ 更新の T番号 は空文字にしない（採番済みの値を消さない）", async () => {
    h.lookup["field-267"] = { A0001: "cust-9" };
    h.customerRecords["cust-9"] = { "field-268": "T00001111" };

    await sync();

    expect(h.updated[0]?.payload["field-268"]).not.toBe("");
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

/**
 * B案: キャッシュ由来の null を信じない防御を、**新規作成へ進む直前**へ移す。
 *
 * 防御そのものは外さない。外すと同じ顧客のレコードが二重にできる。
 * 変えたのは置き場所だけで、
 *   ・Aki が外れても T番号 で当たるなら引き直さない（1往復減る）
 *   ・両方外れて新規作成へ進むときは、必ず両方を引き直す
 * を固定する。
 */
describe("★ 照合の引き直し（B案）", () => {
  const AKI = "field-267";
  const T = "field-268";

  it("★ Aki番号 で当たれば1回しか引かない", async () => {
    h.lookup[AKI] = { A0001: "cust-1" };
    h.customerRecords["cust-1"] = { [T]: "T00003420" };

    await sync();

    expect(h.lookupCalls).toEqual([{ fieldId: AKI, value: "A0001" }]);
    expect(h.refetchCalls).toEqual([]);
    expect(h.created).toHaveLength(0);
  });

  it("★ Aki が外れても T番号 で見つかれば引き直さない", async () => {
    // 移行前の顧客: Aki番号 が入っていないが T番号 では引ける
    h.constructionRecord = {
      "field-101": "A0001",
      "field-1": "T00003420",
      "field-2": "山田 太郎",
    };
    h.lookup[T] = { T00003420: "cust-1" };
    h.customerRecords["cust-1"] = { [T]: "T00003420" };

    await sync({ constructionUniqueKey: "T00003420" });

    // キャッシュ越しに2回（Aki → T番号）だけ。引き直しは無い
    expect(h.lookupCalls).toEqual([
      { fieldId: AKI, value: "A0001" },
      { fieldId: T, value: "T00003420" },
    ]);
    expect(h.refetchCalls).toEqual([]);
    // 既存レコードを更新している（二重作成していない）
    expect(h.created).toHaveLength(0);
    expect(h.updated.some((u) => u.recordId === "cust-1")).toBe(true);
  });

  it("★ 両方外れたら、新規作成の前に必ず引き直す", async () => {
    h.constructionRecord = {
      "field-101": "A0001",
      "field-1": "T00003420",
      "field-2": "山田 太郎",
    };

    await sync({ constructionUniqueKey: "T00003420" });

    expect(h.lookupCalls).toEqual([
      { fieldId: AKI, value: "A0001" },
      { fieldId: T, value: "T00003420" },
    ]);
    // 返す前に、探せるキーを全部引き直している
    expect(h.refetchCalls).toEqual([
      { fieldId: AKI, value: "A0001" },
      { fieldId: T, value: "T00003420" },
    ]);
  });

  it("★ 引き直しで見つかったら新規作成しない（二重作成の防止）", async () => {
    // キャッシュ越しは null を返すが、引き直すと当たる状況
    h.constructionRecord = {
      "field-101": "A0001",
      "field-1": "T00003420",
      "field-2": "山田 太郎",
    };
    h.customerRecords["cust-1"] = { [T]: "T00003420" };
    // 引き直し（refetchCalls に積まれてから）でだけ見つかるようにする
    Object.defineProperty(h, "lookup", {
      configurable: true,
      get: () =>
        h.refetchCalls.length > 0 ? { [AKI]: { A0001: "cust-1" } } : {},
    });

    try {
      await sync({ constructionUniqueKey: "T00003420" });
    } finally {
      Object.defineProperty(h, "lookup", {
        configurable: true,
        writable: true,
        value: {},
      });
    }

    // キャッシュ越しで2回外し、引き直しで拾っている
    expect(h.lookupCalls).toHaveLength(2);
    expect(h.refetchCalls.length).toBeGreaterThan(0);
    // 新規作成へ進んでいない
    expect(h.created).toHaveLength(0);
    expect(h.updated.some((u) => u.recordId === "cust-1")).toBe(true);
  });
  it("★ 引き直しても見つからなければ新規作成する", async () => {
    h.constructionRecord = {
      "field-101": "A0001",
      "field-1": "T00003420",
      "field-2": "山田 太郎",
    };

    await sync({ constructionUniqueKey: "T00003420" });

    expect(h.refetchCalls).toHaveLength(2);
    expect(h.created).toHaveLength(1);
  });

  it("★ 引くキーが無ければ1回も引かない（条件なしで拾わない）", async () => {
    await sync({ customerInfoOnly: true, constructionRecordId: undefined });

    expect(h.lookupCalls).toHaveLength(0);
    expect(h.refetchCalls).toHaveLength(0);
  });
});

/**
 * T番号 の採番待ち。
 *
 * お客様情報アプリの自動採番は反映に一瞬かかる。作成応答の直後に読むと
 * 空で返ることがあり、実機ではこれで新規案件通知が丸ごと落ちていた
 * （[new-case-notification] stage:no-t-number）。
 * 工事アプリへの T番号 書き戻しも同じ値を見ているので一緒に落ちる。
 *
 * ここで固定するのは次の3つ。
 *   - 空なら短く待ち直し、出たら使う
 *   - 1回目で取れたなら待たない（毎回の空振りを増やさない）
 *   - 待っても出なければ諦める。登録は成功のままにする
 */
describe("★ T番号 の採番待ち", () => {
  it("★ 作成直後に空でも、待ち直して取得する", async () => {
    // 1回目の GET は空。2回目で採番が見える
    h.tNumberEmptyUntil = 1;

    const res = await sync();

    expect(res.kind).toBe("synced");
    expect((res as { tNumber?: string }).tNumber).toBe("T00003420");
    expect(h.customerGetCount).toBe(2);
  });

  it("★ 2回空でも3回目で取れる", async () => {
    h.tNumberEmptyUntil = 2;

    const res = await sync();

    expect((res as { tNumber?: string }).tNumber).toBe("T00003420");
    expect(h.customerGetCount).toBe(3);
  });

  it("★ 1回目で取れたら待ち直さない（往復を増やさない）", async () => {
    const res = await sync();

    expect((res as { tNumber?: string }).tNumber).toBe("T00003420");
    expect(h.customerGetCount).toBe(1);
  });

  it("★ 待っても出なければ諦めるが、登録は成功のまま", async () => {
    h.tNumberEmptyUntil = 99;

    const res = await sync();

    expect(res.kind).toBe("synced");
    expect((res as { tNumber?: string }).tNumber).toBeUndefined();
    // 上限は3回。無限には待たない
    expect(h.customerGetCount).toBe(3);
  });

  it("★ 施工予定日が未定の経路でも待ち直す", async () => {
    h.tNumberEmptyUntil = 1;

    const res = await sync({
      customerInfoOnly: true,
      constructionRecordId: undefined,
    });

    expect((res as { tNumber?: string }).tNumber).toBe("T00003420");
  });

  it("既存レコードの更新では待ち直さない（採番済みのため）", async () => {
    h.customerRecords["cust-9"] = {
      "field-268": "T00009999",
      "field-267": "A0001",
    };
    h.lookup = { "field-267": { A0001: "cust-9" } };

    await sync();

    // 既存レコードは1回読むだけ
    expect(h.customerGetCount).toBe(1);
  });
});

/**
 * 作成した recordId を特定できないときの最後の手。
 *
 * 施工予定日なしの経路は工事レコードを作らないので Aki番号 が無い。
 * @pocket が作成応答で ID を返さないと引き直す手がかりが1つも無くなり、
 * T番号 を読む先が消える。実機で通知が落ちていた経路がこれ。
 *
 * 作成前後の一覧を突き合わせて「増えた1件」を採る。アポ取得の登録で
 * 使っている方式をそのまま共通化して使う。
 */
describe("★ recordId の作成前後差分（施工予定日なし）", () => {
  function undated(over: Record<string, unknown> = {}) {
    return sync({
      customerInfoOnly: true,
      constructionRecordId: undefined,
      ...over,
    });
  }

  it("★ 作成応答に ID が無くても、増えた1件から特定して T番号 を読む", async () => {
    h.createReturnsId = false;
    h.listQueue = [
      { records: [{ recordId: "cust-old" }] },
      { records: [{ recordId: "cust-old" }, { recordId: "cust-new" }] },
    ];

    const res = await undated();

    expect((res as { tNumber?: string }).tNumber).toBe("T00003420");
    expect((res as { customerInfoRecordId?: string }).customerInfoRecordId).toBe(
      "cust-new",
    );
  });

  it("★ 同姓同名の既存レコードは掴まない（増えていなければ採らない）", async () => {
    h.createReturnsId = false;
    h.listQueue = [
      { records: [{ recordId: "cust-old" }] },
      { records: [{ recordId: "cust-old" }] },
    ];

    const res = await undated();

    expect(res.kind).toBe("synced");
    expect((res as { customerInfoRecordId?: string }).customerInfoRecordId)
      .toBeUndefined();
  });

  it("★ 2件以上増えていたら特定しない", async () => {
    h.createReturnsId = false;
    h.listQueue = [
      { records: [] },
      { records: [{ recordId: "cust-a" }, { recordId: "cust-b" }] },
    ];

    const res = await undated();

    expect((res as { customerInfoRecordId?: string }).customerInfoRecordId)
      .toBeUndefined();
  });

  it("★ 特定できなくても登録は成功のまま（押し直しによる重複を招かない）", async () => {
    h.createReturnsId = false;
    h.listQueue = [{ records: [] }, { records: [] }];

    const res = await undated();

    expect(res.kind).toBe("synced");
    expect(h.created).toHaveLength(1);
  });

  it("★ 作成応答から ID が取れたら作成後の一覧は取らない（往復を増やさない）", async () => {
    h.listQueue = [{ records: [] }];

    await undated();

    // 作成前の1回だけ
    expect(h.listCalls).toHaveLength(1);
  });

  it("★ お客様名で絞って照合する", async () => {
    h.createReturnsId = false;
    h.listQueue = [{ records: [] }, { records: [{ recordId: "cust-new" }] }];

    await undated();

    expect(h.listCalls[0]).toContain("field-2");
    expect(h.listCalls[0]).toContain("山田 太郎");
  });

  it("★ Aki番号 で引き直せる経路では一覧照合をしない", async () => {
    // 施工予定日あり（Aki番号 が採番済み）。作成後に Aki で引き直せる
    h.createReturnsId = false;
    h.lookupAfterCreateOnly = true;
    h.lookup = { "field-267": { A0001: "cust-new" } };

    const res = await sync();

    // Aki番号 で引けるので、一覧の往復は1回も足さない
    expect(h.listCalls).toEqual([]);
    expect((res as { tNumber?: string }).tNumber).toBe("T00003420");
  });
});
