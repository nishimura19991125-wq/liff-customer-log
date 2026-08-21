import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 未入力一覧（続き入力ショートカット）の絞り込み。
 *
 * タスクVでキャンセル処理を入れたため、キャンセルした案件が
 * 「入力が必要」として残り続けるのを防ぐ。
 */

const h = vi.hoisted(() => ({
  rows: [] as Array<{ recordId: number; record: Record<string, unknown> }>,
  /** fetchRecordsList に渡された fields */
  requestedFields: [] as string[],
}));

const NAME = "field-1";
const AP = "field-2";
const CL = "field-3";
const INPUT_STATUS = "field-4";
const CUSTOMER_STATUS = "field-5";

const APP_FIELDS = [
  { uniqueId: NAME, caption: "お客様名" },
  { uniqueId: AP, caption: "AP担当者" },
  { uniqueId: CL, caption: "CL担当者" },
  { uniqueId: INPUT_STATUS, caption: "入力ステータス" },
  { uniqueId: CUSTOMER_STATUS, caption: "顧客ステータス" },
];

vi.mock("@/lib/customer-info-config", () => ({
  customerInfoConfigReady: () => ({ ok: true, appId: "35" }),
  customerInfoAppId: () => "35",
  customerInfoNameFieldId: () => NAME,
  customerInfoPocketAuth1: () => ({ apiKey: "dummy" }),
  customerInfoSubtitleFieldId: () => "",
  customerInfoCustomerStatusFieldId: () => "",
}));

vi.mock("@/lib/atpocket", () => ({
  fetchAppFields: async () => APP_FIELDS,
  fetchRecordsList: async (
    _appId: string,
    params: { fields?: string; page?: string },
  ) => {
    h.requestedFields = (params.fields ?? "").split(",").filter(Boolean);
    if (params.page !== "1") return { records: [] };
    return { records: h.rows };
  },
}));

const { fetchCustomerInfoPendingSnapshot, filterCustomerInfoPendingForStaff } =
  await import("@/lib/customer-info-continue-shortcut");

function row(
  recordId: number,
  customerName: string,
  inputStatus: string,
  customerStatus: string,
) {
  return {
    recordId,
    record: {
      [NAME]: customerName,
      [AP]: "山田太郎",
      [CL]: "",
      [INPUT_STATUS]: inputStatus,
      [CUSTOMER_STATUS]: customerStatus,
    },
  };
}

async function pendingNames(): Promise<string[]> {
  const snapshot = await fetchCustomerInfoPendingSnapshot();
  return snapshot.candidates.map((c) => c.customerName);
}

beforeEach(() => {
  h.rows = [];
  h.requestedFields = [];
});

describe("★ キャンセル案件を未入力一覧から外す", () => {
  it("キャンセルの案件は対象にならない", async () => {
    h.rows = [
      row(1, "工事待ちの人", "未入力", "工事待ち"),
      row(2, "キャンセルの人", "未入力", "キャンセル"),
    ];

    expect(await pendingNames()).toEqual(["工事待ちの人"]);
  });

  it("★ キャンセル以外は従来どおり対象になる", async () => {
    h.rows = [
      row(1, "工事待ちの人", "未入力", "工事待ち"),
      row(2, "完工の人", "未入力", "完工"),
      row(3, "残工の人", "未入力", "残工"),
      row(4, "完了の人", "未入力", "完了"),
      row(5, "ステータス未設定の人", "未入力", ""),
    ];

    expect(await pendingNames()).toEqual([
      "工事待ちの人",
      "完工の人",
      "残工の人",
      "完了の人",
      "ステータス未設定の人",
    ]);
  });

  it("入力ステータスが未入力でなければ、キャンセル以外でも対象にならない", async () => {
    h.rows = [
      row(1, "入力済みの人", "入力完了", "工事待ち"),
      row(2, "未入力の人", "未入力", "工事待ち"),
    ];

    expect(await pendingNames()).toEqual(["未入力の人"]);
  });

  it("キャンセルかつ入力完了でも当然対象にならない", async () => {
    h.rows = [row(1, "キャンセル済み", "入力完了", "キャンセル")];

    expect(await pendingNames()).toEqual([]);
  });

  it("お客様名が空の行は従来どおり対象外", async () => {
    h.rows = [row(1, "", "未入力", "工事待ち")];

    expect(await pendingNames()).toEqual([]);
  });

  it("顧客ステータス列を取得対象に含める", async () => {
    h.rows = [row(1, "誰か", "未入力", "工事待ち")];

    await fetchCustomerInfoPendingSnapshot();

    // 列を要求していないと値が読めず、キャンセルを外せない
    expect(h.requestedFields).toContain(CUSTOMER_STATUS);
  });
});

describe("担当者での絞り込みは従来どおり", () => {
  it("AP担当が一致する案件だけ出る", async () => {
    h.rows = [
      row(1, "山田の案件", "未入力", "工事待ち"),
      {
        recordId: 2,
        record: {
          [NAME]: "他人の案件",
          [AP]: "冨田菜摘",
          [CL]: "",
          [INPUT_STATUS]: "未入力",
          [CUSTOMER_STATUS]: "工事待ち",
        },
      },
    ];

    const snapshot = await fetchCustomerInfoPendingSnapshot();
    const hits = filterCustomerInfoPendingForStaff(snapshot, "山田太郎");

    expect(hits.map((hz) => hz.customerName)).toEqual(["山田の案件"]);
  });

  it("キャンセルは担当者が一致していても出ない", async () => {
    h.rows = [row(1, "キャンセルの人", "未入力", "キャンセル")];

    const snapshot = await fetchCustomerInfoPendingSnapshot();
    const hits = filterCustomerInfoPendingForStaff(snapshot, "山田太郎");

    expect(hits).toEqual([]);
  });
});
