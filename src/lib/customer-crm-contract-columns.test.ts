import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 契約情報入力の5列を、お客様情報の全件キャッシュに載せる（残工 段階1）。
 *
 *   - メーカー・太陽光パネル容量・蓄電池容量①②・市区郡が載る
 *   - 列は 環境変数（CUSTOMER_INFO_FIELD_*）→ フォーム定義の見出し で決める
 *   - 列が増えるだけで、@pocket の呼び出し回数は増えない
 *   - 列が無い環境では付けない（CSV も伸びない）
 *   - /api/customers の応答には載せない
 *
 * 取得の土台は customer-crm-snapshot.test.ts と同じ。
 */

const NAME_ID = "field-1";
const T_ID = "field-2";
const STATUS_ID = "field-3";
const AP_ID = "field-7";
const MAKER_ID = "field-201";
const PANEL_ID = "field-216";
const BAT1_ID = "field-210";
const BAT2_ID = "field-211";
const CITY_ID = "field-10";

const h = vi.hoisted(() => ({
  defaultRows: [] as unknown[],
  listCalls: [] as { page?: string; fields?: string }[],
  fieldsCalls: 0,
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
      return { records: h.defaultRows };
    },
  };
});

/** フォーム定義（schema.ts）と同じ見出し */
const BASE_FIELDS = [
  { uniqueId: NAME_ID, caption: "お客様名" },
  { uniqueId: T_ID, caption: "T番号" },
  { uniqueId: STATUS_ID, caption: "顧客ステータス" },
  { uniqueId: AP_ID, caption: "AP担当者" },
];
const CONTRACT_FIELDS = [
  { uniqueId: MAKER_ID, caption: "メーカー" },
  { uniqueId: PANEL_ID, caption: "太陽光パネル容量(kw)" },
  { uniqueId: BAT1_ID, caption: "蓄電池容量(kWh)①" },
  { uniqueId: BAT2_ID, caption: "蓄電池容量(kWh)②" },
  { uniqueId: CITY_ID, caption: "市区郡" },
];

function row(recordId: number, record: Record<string, unknown>) {
  return { recordId, record };
}

const ENV_KEYS = [
  "CUSTOMER_INFO_APP_ID",
  "CUSTOMER_INFO_CUSTOMER_NAME_FIELD_ID",
  "CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID",
  "CUSTOMER_INFO_CUSTOMER_STATUS_FIELD_ID",
  "CUSTOMER_INFO_FIELD_MANUFACTURER",
  "CUSTOMER_INFO_FIELD_CITY",
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
  delete process.env.CUSTOMER_INFO_FIELD_MANUFACTURER;
  delete process.env.CUSTOMER_INFO_FIELD_CITY;
  process.env.CUSTOMER_CRM_PAGE_DELAY_MS = "0";
  delete process.env.CUSTOMER_CRM_MAX_PAGES;
  delete process.env.CUSTOMER_CRM_CACHE_TTL_MS;

  h.defaultRows = [];
  h.listCalls.length = 0;
  h.fieldsCalls = 0;
  h.fields = [...BASE_FIELDS, ...CONTRACT_FIELDS];
  invalidateCustomerCrmListCache();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const FULL_ROW = {
  [NAME_ID]: "山田 太郎",
  [T_ID]: "T0001",
  [MAKER_ID]: "長州産業",
  [PANEL_ID]: "5.6",
  [BAT1_ID]: "9.8",
  [BAT2_ID]: "6.5",
  [CITY_ID]: "福岡市",
};

describe("契約情報入力の5列（残工 段階1）", () => {
  it("★ 5列がスナップショットに載る", async () => {
    h.defaultRows = [row(11, FULL_ROW)];

    const snapshot = await getCachedCustomerCrmSnapshot();

    expect(snapshot.items[0]?.contract).toEqual({
      manufacturer: "長州産業",
      panelCapacity: "5.6",
      batteryCapacity1: "9.8",
      batteryCapacity2: "6.5",
      city: "福岡市",
    });
  });

  it("★ 5列が fields CSV に載り、呼び出し回数は増えない", async () => {
    h.defaultRows = [row(11, FULL_ROW)];

    await getCachedCustomerCrmSnapshot();

    const csv = (h.listCalls[0]?.fields ?? "").split(",");
    for (const id of [MAKER_ID, PANEL_ID, BAT1_ID, BAT2_ID, CITY_ID]) {
      expect(csv).toContain(id);
    }
    expect(h.listCalls).toHaveLength(1);
    expect(h.fieldsCalls).toBe(1);
  });

  it("★ 環境変数（CUSTOMER_INFO_FIELD_*）で列を指定できる", async () => {
    h.fields = [
      ...BASE_FIELDS,
      ...CONTRACT_FIELDS,
      { uniqueId: "field-900", caption: "メーカー（旧）" },
      { uniqueId: "field-901", caption: "設置先市区郡" },
    ];
    process.env.CUSTOMER_INFO_FIELD_MANUFACTURER = "field-900";
    process.env.CUSTOMER_INFO_FIELD_CITY = "field-901";
    h.defaultRows = [
      row(11, { ...FULL_ROW, "field-900": "パナソニック", "field-901": "北九州市" }),
    ];

    const snapshot = await getCachedCustomerCrmSnapshot();

    expect(snapshot.items[0]?.contract?.manufacturer).toBe("パナソニック");
    expect(snapshot.items[0]?.contract?.city).toBe("北九州市");
  });

  it("★ 列が無い環境では付けず、CSV も伸びない", async () => {
    h.fields = [...BASE_FIELDS];
    h.defaultRows = [row(11, { [NAME_ID]: "山田 太郎", [T_ID]: "T0001" })];

    const snapshot = await getCachedCustomerCrmSnapshot();

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0]).not.toHaveProperty("contract");
    const csv = (h.listCalls[0]?.fields ?? "").split(",");
    for (const id of [MAKER_ID, PANEL_ID, BAT1_ID, BAT2_ID, CITY_ID]) {
      expect(csv).not.toContain(id);
    }
  });

  it("★ /api/customers の応答（CustomerCrmListItem）には載せない", async () => {
    h.defaultRows = [row(11, { ...FULL_ROW, [AP_ID]: "佐藤 花子" })];

    const items = await listCustomerCrmRecords("佐藤 花子");

    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty("contract");
  });
});
