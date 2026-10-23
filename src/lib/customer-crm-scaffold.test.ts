import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 施工管理タブ向けに、お客様情報の全件スナップショットへ足場の4項目を足す。
 *
 * ここで固定するのは次の4つ。
 *   - 環境変数で指定した4列が取得列に入り、スナップショットに値が載る
 *   - 環境変数が無ければ取得列に足さない（見出しで探し直さない）
 *   - @pocket への問い合わせ回数とページ数は変わらない
 *   - 担当顧客一覧（/api/customers）の応答は変えない
 */

const NAME_ID = "field-1";
const T_ID = "field-2";
const STATUS_ID = "field-3";
const DATE_ID = "field-4";
const AP_ID = "field-7";
const SCAFFOLD_CONTRACTOR_ID = "field-312";
const SCAFFOLD_REQUEST_ID = "field-313";
const SCAFFOLD_INSTALL_ID = "field-314";
const SCAFFOLD_REMOVAL_ID = "field-315";

const SCAFFOLD_IDS = [
  SCAFFOLD_CONTRACTOR_ID,
  SCAFFOLD_REQUEST_ID,
  SCAFFOLD_INSTALL_ID,
  SCAFFOLD_REMOVAL_ID,
];

const h = vi.hoisted(() => ({
  /** page 番号 → その回で返すレコード配列 */
  pages: new Map<string, unknown[]>(),
  /** 既定の応答（pages に無い page 用） */
  defaultRows: [] as unknown[],
  listCalls: [] as { page?: string; fields?: string }[],
  fieldsCalls: 0,
  /** GET /fields が返す列定義 */
  fields: [] as { uniqueId: string; caption: string }[],
}));

vi.mock("@/lib/atpocket", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/atpocket")>("@/lib/atpocket");
  return {
    ...actual,
    readAuthsForApp: () => [{ apiKey: "read-key" }],
    listAuthsForAppList: () => [{ apiKey: "list-key" }],
    fetchAppFieldsTryKeys: async () => {
      h.fieldsCalls += 1;
      return h.fields;
    },
    fetchRecordsList: async (
      _appId: string,
      params?: { page?: string; fields?: string },
    ) => {
      h.listCalls.push({ page: params?.page, fields: params?.fields });
      const page = params?.page ?? "1";
      return { records: h.pages.get(page) ?? h.defaultRows };
    },
  };
});

/** 見出しは @pocket と同じ名前にしておく（見出しで拾われないことを確かめるため） */
const FIELDS = [
  { uniqueId: NAME_ID, caption: "お客様名" },
  { uniqueId: T_ID, caption: "T番号" },
  { uniqueId: STATUS_ID, caption: "顧客ステータス" },
  { uniqueId: DATE_ID, caption: "施工予定日" },
  { uniqueId: AP_ID, caption: "AP担当者" },
  { uniqueId: SCAFFOLD_CONTRACTOR_ID, caption: "足場業者" },
  { uniqueId: SCAFFOLD_REQUEST_ID, caption: "足場依頼内容" },
  { uniqueId: SCAFFOLD_INSTALL_ID, caption: "足場設置日" },
  { uniqueId: SCAFFOLD_REMOVAL_ID, caption: "足場解体日" },
];

const SCAFFOLD_ENV = {
  CUSTOMER_INFO_FIELD_SCAFFOLD_CONTRACTOR: SCAFFOLD_CONTRACTOR_ID,
  CUSTOMER_INFO_FIELD_SCAFFOLD_REQUEST: SCAFFOLD_REQUEST_ID,
  CUSTOMER_INFO_FIELD_SCAFFOLD_INSTALL_DATE: SCAFFOLD_INSTALL_ID,
  CUSTOMER_INFO_FIELD_SCAFFOLD_REMOVAL_DATE: SCAFFOLD_REMOVAL_ID,
} as const;

function row(recordId: number, record: Record<string, unknown>) {
  return { recordId, record };
}

const ENV_KEYS = [
  "CUSTOMER_INFO_APP_ID",
  "CUSTOMER_INFO_CUSTOMER_NAME_FIELD_ID",
  "CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID",
  "CUSTOMER_INFO_CUSTOMER_STATUS_FIELD_ID",
  "CUSTOMER_INFO_CONSTRUCTION_DATE_FIELD_ID",
  "CUSTOMER_CRM_PAGE_DELAY_MS",
  "CUSTOMER_CRM_MAX_PAGES",
  "CUSTOMER_CRM_CACHE_TTL_MS",
  ...Object.keys(SCAFFOLD_ENV),
] as const;

const savedEnv: Record<string, string | undefined> = {};

const {
  getCachedCustomerCrmSnapshot,
  invalidateCustomerCrmListCache,
  listCustomerCrmRecords,
} = await import("@/lib/customer-crm-list");

function setScaffoldEnv(): void {
  for (const [k, v] of Object.entries(SCAFFOLD_ENV)) process.env[k] = v;
}

function clearScaffoldEnv(): void {
  for (const k of Object.keys(SCAFFOLD_ENV)) delete process.env[k];
}

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.CUSTOMER_INFO_APP_ID = "app-1";
  process.env.CUSTOMER_INFO_CUSTOMER_NAME_FIELD_ID = NAME_ID;
  process.env.CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID = T_ID;
  process.env.CUSTOMER_INFO_CUSTOMER_STATUS_FIELD_ID = STATUS_ID;
  process.env.CUSTOMER_INFO_CONSTRUCTION_DATE_FIELD_ID = DATE_ID;
  process.env.CUSTOMER_CRM_PAGE_DELAY_MS = "0";
  delete process.env.CUSTOMER_CRM_MAX_PAGES;
  delete process.env.CUSTOMER_CRM_CACHE_TTL_MS;
  clearScaffoldEnv();

  h.pages.clear();
  h.defaultRows = [];
  h.listCalls.length = 0;
  h.fieldsCalls = 0;
  h.fields = [...FIELDS];

  invalidateCustomerCrmListCache();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

function csvOf(callIndex = 0): string[] {
  return (h.listCalls[callIndex]?.fields ?? "").split(",");
}

describe("足場の4項目（環境変数あり）", () => {
  it("★ 4列が取得列に入る", async () => {
    setScaffoldEnv();
    h.defaultRows = [row(11, { [NAME_ID]: "顧客A" })];

    await getCachedCustomerCrmSnapshot();

    for (const id of SCAFFOLD_IDS) expect(csvOf()).toContain(id);
  });

  it("★ 値がスナップショットに載る（日付は YYYY-MM-DD にそろえる）", async () => {
    setScaffoldEnv();
    h.defaultRows = [
      row(11, {
        [NAME_ID]: "顧客A",
        [SCAFFOLD_CONTRACTOR_ID]: "足場業者A",
        [SCAFFOLD_REQUEST_ID]: "設置と解体",
        [SCAFFOLD_INSTALL_ID]: "2026/11/3",
        [SCAFFOLD_REMOVAL_ID]: "2026-11-20",
      }),
    ];

    const snapshot = await getCachedCustomerCrmSnapshot();

    expect(snapshot.items[0]?.scaffold).toEqual({
      contractor: "足場業者A",
      request: "設置と解体",
      installDate: "2026-11-03",
      removalDate: "2026-11-20",
    });
  });

  it("★ Z 付きの日時は JST の日付にそろえる（UTC 10/31 15:00 は JST 11/1）", async () => {
    setScaffoldEnv();
    h.defaultRows = [
      row(11, {
        [NAME_ID]: "顧客A",
        [SCAFFOLD_INSTALL_ID]: "2026-10-31T15:00:00Z",
        [SCAFFOLD_REMOVAL_ID]: "2026-11-30T14:59:59Z",
      }),
    ];

    const snapshot = await getCachedCustomerCrmSnapshot();

    expect(snapshot.items[0]?.scaffold?.installDate).toBe("2026-11-01");
    expect(snapshot.items[0]?.scaffold?.removalDate).toBe("2026-11-30");
  });

  it("お客様情報の施工予定日も JST の YYYY-MM-DD で持つ（取得列は増えない）", async () => {
    setScaffoldEnv();
    h.defaultRows = [
      row(11, { [NAME_ID]: "顧客A", [DATE_ID]: "2026/12/3" }),
      row(12, { [NAME_ID]: "顧客B" }),
    ];

    const snapshot = await getCachedCustomerCrmSnapshot();

    const byId = (id: string) =>
      snapshot.items.find((i) => i.recordId === id)?.constructionDate;
    expect(byId("11")).toBe("2026-12-03");
    expect(byId("12")).toBe("");
    expect(h.listCalls).toHaveLength(1);
  });

  it("値が空のレコードは空文字になる", async () => {
    setScaffoldEnv();
    h.defaultRows = [row(11, { [NAME_ID]: "顧客A" })];

    const snapshot = await getCachedCustomerCrmSnapshot();

    expect(snapshot.items[0]?.scaffold).toEqual({
      contractor: "",
      request: "",
      installDate: "",
      removalDate: "",
    });
  });
});

describe("足場の4項目（環境変数なし）", () => {
  it("★ 環境変数が無ければ取得列に足さない（見出しが一致しても拾わない）", async () => {
    h.defaultRows = [
      row(11, {
        [NAME_ID]: "顧客A",
        [SCAFFOLD_CONTRACTOR_ID]: "足場業者A",
      }),
    ];

    const snapshot = await getCachedCustomerCrmSnapshot();

    for (const id of SCAFFOLD_IDS) expect(csvOf()).not.toContain(id);
    expect(snapshot.items[0]?.scaffold).toEqual({
      contractor: "",
      request: "",
      installDate: "",
      removalDate: "",
    });
  });

  it("★ 1つだけ設定されていれば、その列だけ足す", async () => {
    process.env.CUSTOMER_INFO_FIELD_SCAFFOLD_INSTALL_DATE = SCAFFOLD_INSTALL_ID;
    h.defaultRows = [row(11, { [NAME_ID]: "顧客A" })];

    await getCachedCustomerCrmSnapshot();

    expect(csvOf()).toContain(SCAFFOLD_INSTALL_ID);
    expect(csvOf()).not.toContain(SCAFFOLD_CONTRACTOR_ID);
    expect(csvOf()).not.toContain(SCAFFOLD_REQUEST_ID);
    expect(csvOf()).not.toContain(SCAFFOLD_REMOVAL_ID);
  });

  it("★ アプリ定義に無い列を指定されたら足さず、環境変数名だけを警告に出す", async () => {
    setScaffoldEnv();
    h.fields = FIELDS.filter((f) => f.uniqueId !== SCAFFOLD_REMOVAL_ID);
    h.defaultRows = [row(11, { [NAME_ID]: "顧客A" })];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const snapshot = await getCachedCustomerCrmSnapshot();

    expect(csvOf()).not.toContain(SCAFFOLD_REMOVAL_ID);
    expect(csvOf()).toContain(SCAFFOLD_INSTALL_ID);
    // 一覧そのものは止めない
    expect(snapshot.items).toHaveLength(1);
    const dumped = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(dumped).toContain("CUSTOMER_INFO_FIELD_SCAFFOLD_REMOVAL_DATE");
    // 値（列ID）は出さない
    expect(dumped).not.toContain(SCAFFOLD_REMOVAL_ID);
  });
});

describe("@pocket への問い合わせ", () => {
  /** limit=1000 を満たす1ページぶん */
  function fullPage(offset: number): unknown[] {
    return Array.from({ length: 1000 }, (_, i) =>
      row(offset + i + 1, { [NAME_ID]: `顧客${offset + i + 1}` }),
    );
  }

  async function runTwoPages(): Promise<{
    pages: (string | undefined)[];
    fieldsCalls: number;
  }> {
    invalidateCustomerCrmListCache();
    h.listCalls.length = 0;
    h.fieldsCalls = 0;
    h.pages.set("1", fullPage(0));
    h.pages.set("2", [row(9001, { [NAME_ID]: "顧客Z" })]);
    await getCachedCustomerCrmSnapshot();
    return {
      pages: h.listCalls.map((c) => c.page),
      fieldsCalls: h.fieldsCalls,
    };
  }

  it("★ 足場の列を足しても、問い合わせ回数とページ数は変わらない", async () => {
    const before = await runTwoPages();
    setScaffoldEnv();
    const after = await runTwoPages();

    expect(before.pages).toEqual(["1", "2"]);
    expect(after.pages).toEqual(before.pages);
    expect(after.fieldsCalls).toBe(before.fieldsCalls);
  });

  it("★ 2回目はキャッシュから返る（全件走査を増やさない）", async () => {
    setScaffoldEnv();
    h.defaultRows = [row(11, { [NAME_ID]: "顧客A" })];

    await getCachedCustomerCrmSnapshot();
    await getCachedCustomerCrmSnapshot();

    expect(h.listCalls).toHaveLength(1);
    expect(h.fieldsCalls).toBe(1);
  });
});

describe("担当顧客一覧（/api/customers）の応答", () => {
  it("★ 項目は従来どおり。足場の値は載せない", async () => {
    setScaffoldEnv();
    h.defaultRows = [
      row(11, {
        [NAME_ID]: "顧客A",
        [AP_ID]: "担当A",
        [SCAFFOLD_CONTRACTOR_ID]: "足場業者A",
        [SCAFFOLD_INSTALL_ID]: "2026-11-03",
      }),
    ];

    const items = await listCustomerCrmRecords("担当A");

    expect(items).toHaveLength(1);
    expect(Object.keys(items[0]!).sort()).toEqual(
      [
        "recordId",
        "customerName",
        "subtitle",
        "tNumber",
        "isDocumentMissing",
        "isSubsidyTarget",
        "combinedSubsidyName",
        "isConstructionDateUnset",
        "isCancelled",
        "isCompleted",
      ].sort(),
    );
  });
});
