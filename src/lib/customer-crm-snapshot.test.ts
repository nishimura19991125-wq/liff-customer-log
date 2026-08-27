import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 担当顧客スナップショット（絞り込み前の全件）の準備（3-1）。
 *
 * ここで固定するのは次の4つ。
 *   - スナップショットに住宅ステータス・施工業者が載る
 *   - 列を解決できない環境でも壊れず、fields CSV も伸びない
 *   - 取得ページ数の上限に達したら警告が出る（個人情報は出さない）
 *   - @pocket の呼び出し回数が増えない（キャッシュを共有する）
 *
 * ★ 担当顧客一覧（/api/customers）の応答は 3-1 で変えない。
 *   新しい2列は内部の CrmCandidate にだけ持たせ、CustomerCrmListItem
 *   には載せていない。それも回帰として固定する。
 */

const NAME_ID = "field-1";
const T_ID = "field-2";
const STATUS_ID = "field-3";
const DATE_ID = "field-4";
const HOUSING_ID = "field-5";
const CONTRACTOR_ID = "field-6";
const AP_ID = "field-7";

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

const FULL_FIELDS = [
  { uniqueId: NAME_ID, caption: "お客様名" },
  { uniqueId: T_ID, caption: "T番号" },
  { uniqueId: STATUS_ID, caption: "顧客ステータス" },
  { uniqueId: DATE_ID, caption: "施工予定日" },
  { uniqueId: HOUSING_ID, caption: "住宅ステータス" },
  { uniqueId: CONTRACTOR_ID, caption: "施工業者" },
  { uniqueId: AP_ID, caption: "AP担当者" },
];

/** 住宅ステータス・施工業者の列が無いお客様情報アプリ */
const FIELDS_WITHOUT_NEW_COLUMNS = FULL_FIELDS.filter(
  (f) => f.uniqueId !== HOUSING_ID && f.uniqueId !== CONTRACTOR_ID,
);

function row(recordId: number, record: Record<string, unknown>) {
  return { recordId, record };
}

const ENV_KEYS = [
  "CUSTOMER_INFO_APP_ID",
  "CUSTOMER_INFO_CUSTOMER_NAME_FIELD_ID",
  "CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID",
  "CUSTOMER_INFO_CUSTOMER_STATUS_FIELD_ID",
  "CUSTOMER_INFO_CONSTRUCTION_DATE_FIELD_ID",
  "CUSTOMER_INFO_HOUSING_STATUS_FIELD_ID",
  "CUSTOMER_INFO_CONSTRUCTION_CONTRACTOR_FIELD_ID",
  "CUSTOMER_CRM_PAGE_DELAY_MS",
  "CUSTOMER_CRM_MAX_PAGES",
  "CUSTOMER_CRM_CACHE_TTL_MS",
] as const;

const savedEnv: Record<string, string | undefined> = {};

const {
  getCachedCustomerCrmSnapshot,
  invalidateCustomerCrmListCache,
  listCustomerCrmRecords,
} = await import("@/lib/customer-crm-list");

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.CUSTOMER_INFO_APP_ID = "app-1";
  process.env.CUSTOMER_INFO_CUSTOMER_NAME_FIELD_ID = NAME_ID;
  process.env.CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID = T_ID;
  process.env.CUSTOMER_INFO_CUSTOMER_STATUS_FIELD_ID = STATUS_ID;
  process.env.CUSTOMER_INFO_CONSTRUCTION_DATE_FIELD_ID = DATE_ID;
  delete process.env.CUSTOMER_INFO_HOUSING_STATUS_FIELD_ID;
  delete process.env.CUSTOMER_INFO_CONSTRUCTION_CONTRACTOR_FIELD_ID;
  // ページ間の待ちはテストでは不要
  process.env.CUSTOMER_CRM_PAGE_DELAY_MS = "0";
  delete process.env.CUSTOMER_CRM_MAX_PAGES;
  delete process.env.CUSTOMER_CRM_CACHE_TTL_MS;

  h.pages.clear();
  h.defaultRows = [];
  h.listCalls.length = 0;
  h.fieldsCalls = 0;
  h.fields = [...FULL_FIELDS];

  // モジュール内のキャッシュを毎回捨てる（本番と同じ入口を使う）
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


describe("スナップショットの住宅ステータス・施工業者（3-1）", () => {
  it("★ 2列がスナップショットに載る", async () => {
    h.defaultRows = [
      row(11, {
        [NAME_ID]: "山田 太郎",
        [T_ID]: "T00001",
        [STATUS_ID]: "工事待ち",
        [HOUSING_ID]: "既築案件",
        [CONTRACTOR_ID]: "株式会社アルファ",
      }),
    ];

    const snapshot = await getCachedCustomerCrmSnapshot();

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0]?.housingStatus).toBe("既築案件");
    expect(snapshot.items[0]?.contractorName).toBe("株式会社アルファ");
  });

  it("★ 2列が fields CSV に載る（GET の回数は増えない）", async () => {
    h.defaultRows = [row(11, { [NAME_ID]: "山田 太郎" })];

    await getCachedCustomerCrmSnapshot();

    const csv = h.listCalls[0]?.fields ?? "";
    expect(csv.split(",")).toContain(HOUSING_ID);
    expect(csv.split(",")).toContain(CONTRACTOR_ID);
    // 1ページで終わるデータなので、一覧 GET は1回のまま
    expect(h.listCalls).toHaveLength(1);
  });

  it("環境変数で列を上書きできる", async () => {
    process.env.CUSTOMER_INFO_HOUSING_STATUS_FIELD_ID = HOUSING_ID;
    process.env.CUSTOMER_INFO_CONSTRUCTION_CONTRACTOR_FIELD_ID = CONTRACTOR_ID;
    h.defaultRows = [
      row(11, {
        [NAME_ID]: "山田 太郎",
        [HOUSING_ID]: "新築案件",
        [CONTRACTOR_ID]: "株式会社ベータ",
      }),
    ];

    const snapshot = await getCachedCustomerCrmSnapshot();

    expect(snapshot.items[0]?.housingStatus).toBe("新築案件");
    expect(snapshot.items[0]?.contractorName).toBe("株式会社ベータ");
  });

  it("★ 列が無い環境でも壊れず、CSV も伸びない", async () => {
    h.fields = [...FIELDS_WITHOUT_NEW_COLUMNS];
    h.defaultRows = [
      row(11, { [NAME_ID]: "山田 太郎", [STATUS_ID]: "工事待ち" }),
    ];

    const snapshot = await getCachedCustomerCrmSnapshot();

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0]?.housingStatus).toBe("");
    expect(snapshot.items[0]?.contractorName).toBe("");

    const csv = h.listCalls[0]?.fields ?? "";
    expect(csv.split(",")).not.toContain(HOUSING_ID);
    expect(csv.split(",")).not.toContain(CONTRACTOR_ID);
  });

  it("★ /api/customers の応答（CustomerCrmListItem）には載せない", async () => {
    h.defaultRows = [
      row(11, {
        [NAME_ID]: "山田 太郎",
        [AP_ID]: "佐藤 花子",
        [HOUSING_ID]: "既築案件",
        [CONTRACTOR_ID]: "株式会社アルファ",
      }),
    ];

    const items = await listCustomerCrmRecords("佐藤 花子");

    expect(items).toHaveLength(1);
    // 内部にしか持たない。応答の形を変えると画面・型の互換が崩れる
    expect(items[0]).not.toHaveProperty("housingStatus");
    expect(items[0]).not.toHaveProperty("contractorName");
    // 既存の項目はそのまま
    expect(items[0]?.customerName).toBe("山田 太郎");
  });
});

describe("取得ページ数の上限（3-1）", () => {
  /** limit=1000 を満たす1ページぶん。中身は名前だけでよい */
  function fullPage(): unknown[] {
    return Array.from({ length: 1000 }, (_, i) =>
      row(i + 1, { [NAME_ID]: `顧客${i + 1}` }),
    );
  }

  it("★ 上限ページまで満杯なら警告を出す", async () => {
    process.env.CUSTOMER_CRM_MAX_PAGES = "2";
    h.defaultRows = fullPage();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await getCachedCustomerCrmSnapshot();

    expect(h.listCalls).toHaveLength(2);
    const capWarn = warn.mock.calls.find((c) =>
      String(c[0]).includes("取得ページ数の上限"),
    );
    expect(capWarn).toBeDefined();
    expect(String(capWarn?.[0])).toContain("CUSTOMER_CRM_MAX_PAGES");
  });

  it("★ 警告に個人情報を出さない", async () => {
    process.env.CUSTOMER_CRM_MAX_PAGES = "1";
    h.defaultRows = fullPage().map((_, i) =>
      row(i + 1, { [NAME_ID]: `山田太郎${i}`, [T_ID]: `T0000${i}` }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await getCachedCustomerCrmSnapshot();

    const capWarn = warn.mock.calls.find((c) =>
      String(c[0]).includes("取得ページ数の上限"),
    );
    expect(capWarn).toBeDefined();
    const dumped = capWarn?.map((a) => String(a)).join(" ") ?? "";
    expect(dumped).not.toContain("山田");
    expect(dumped).not.toContain("T0000");
    // 出すのは件数と設定値だけ
    expect(JSON.parse(String(capWarn?.[1]))).toEqual({
      maxPages: 1,
      pageLimit: 1000,
      loaded: 1000,
    });
  });

  it("最終ページが満杯でなければ警告を出さない", async () => {
    process.env.CUSTOMER_CRM_MAX_PAGES = "2";
    h.pages.set("1", fullPage());
    h.pages.set("2", [row(9001, { [NAME_ID]: "山田 太郎" })]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await getCachedCustomerCrmSnapshot();

    expect(h.listCalls).toHaveLength(2);
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes("取得ページ数の上限")),
    ).toBe(false);
  });

  it("途中で0件になったら警告を出さない", async () => {
    process.env.CUSTOMER_CRM_MAX_PAGES = "3";
    h.pages.set("1", fullPage());
    h.pages.set("2", []);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await getCachedCustomerCrmSnapshot();

    expect(h.listCalls).toHaveLength(2);
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes("取得ページ数の上限")),
    ).toBe(false);
  });
});

describe("@pocket の呼び出し回数（3-1）", () => {
  it("★ 全件走査を増やさない。2回目はキャッシュから返る", async () => {
    h.defaultRows = [row(11, { [NAME_ID]: "山田 太郎", [AP_ID]: "佐藤 花子" })];


    await getCachedCustomerCrmSnapshot();
    await getCachedCustomerCrmSnapshot();
    // 担当顧客一覧も同じキャッシュを共有する
    await listCustomerCrmRecords("佐藤 花子");

    expect(h.listCalls).toHaveLength(1);
    expect(h.fieldsCalls).toBe(1);
  });

  it("★ スナップショットは担当者で絞られていない（全件が入る）", async () => {
    h.defaultRows = [
      row(11, { [NAME_ID]: "山田 太郎", [AP_ID]: "佐藤 花子" }),
      row(12, { [NAME_ID]: "鈴木 一郎", [AP_ID]: "高橋 二郎" }),
    ];


    const snapshot = await getCachedCustomerCrmSnapshot();
    expect(snapshot.items).toHaveLength(2);

    // 取り出したあとに絞る、という約束は変わっていない
    const mine = await listCustomerCrmRecords("佐藤 花子");
    expect(mine.map((c) => c.customerName)).toEqual(["山田 太郎"]);
    expect(snapshot.items).toHaveLength(2);
  });
});
