import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * アポ取得時入力の必須判定。
 *
 * 4fd1151 で商談・資料送付予定日時を任意にしたのに実機で弾かれ続けたのは、
 * createApoAcquisitionRecord に spec.required を見ない独自の必須チェックが
 * 残っていたため（必須が二重管理になっていた）。
 *
 * 必須は APO_ACQUISITION_FIELD_SPECS が唯一の情報源であること、
 * つまり spec.required を切り替えれば登録の可否もそのとおりに変わることを
 * ここで固定する。
 */

const h = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
}));

/** 見出しで引ける実物に近い列定義 */
const FIELDS = [
  { uniqueId: "field-1", caption: "AP担当者", fieldType: "SingleLineText" },
  { uniqueId: "field-2", caption: "CL担当者", fieldType: "SingleLineText" },
  { uniqueId: "field-3", caption: "アポ取得日", fieldType: "Date" },
  { uniqueId: "field-4", caption: "ギフト券", fieldType: "SingleSelect" },
  { uniqueId: "field-5", caption: "アポランク", fieldType: "SingleSelect" },
  { uniqueId: "field-6", caption: "アポ種別", fieldType: "SingleSelect" },
  { uniqueId: "field-7", caption: "見積種別", fieldType: "SingleSelect" },
  {
    uniqueId: "field-8",
    caption: "商談・資料送付予定日時",
    fieldType: "DateTime",
  },
  { uniqueId: "field-9", caption: "お客様名", fieldType: "SingleLineText" },
  { uniqueId: "field-10", caption: "初回商談予定日", fieldType: "Date" },
  { uniqueId: "field-11", caption: "見積ステータス", fieldType: "SingleSelect" },
];

vi.mock("@/lib/atpocket", () => ({
  apiKeyForSalesDashboardApoPocket: () => "read-key",
  apiKeyForSalesDashboardApoWrite: () => "write-key",
  salesDashboardApoWriteConfigured: () => true,
  fetchAppFields: async () => FIELDS,
  fetchRecordById: async () => ({ record: {} }),
  createRecord: async (_appId: string, payload: Record<string, unknown>) => {
    h.created.push(payload);
    return { recordIdHint: "rec-1", row: null, location: null };
  },
  updateRecord: async (
    _appId: string,
    _recordId: string,
    patch: Record<string, unknown>,
  ) => {
    h.updated.push(patch);
    return { ok: true };
  },
}));

vi.mock("@/lib/sales-dashboard-fields", () => ({
  salesDashboardApoAppId: () => "app-apo",
}));

vi.mock("@/lib/staff-ap-cl-candidates", () => ({
  resolveStaffRelationPocketValue: async (name: string) => ({
    ok: true as const,
    value: name,
  }),
  fetchApClStaffPickerPayload: async () => ({
    ap: { options: ["西村 直也"] },
    cl: { options: ["別人 太郎"] },
  }),
}));

vi.mock("@/lib/dropbox", () => ({
  dropboxApoConfigured: () => false,
}));

const { createApoAcquisitionRecord } = await import(
  "@/lib/apo-acquisition-server"
);
const { APO_ACQUISITION_FIELD_SPECS } = await import(
  "@/lib/apo-acquisition-fields"
);

/** 現在の必須7項目を満たす入力 */
const FILLED = {
  apStaff: "西村 直也",
  apoAcquiredDate: "2026-08-26",
  giftCoupon: "有",
  apoRank: "A",
  apoType: "新規",
  estimateType: "概算",
  customerName: "山田 太郎",
};

function create(values: Record<string, string>) {
  return createApoAcquisitionRecord("西村 直也", {
    apStaffName: "西村 直也",
    values,
  });
}

beforeEach(() => {
  h.created = [];
  h.updated = [];
});

describe("★ 必須の情報源は APO_ACQUISITION_FIELD_SPECS だけ", () => {
  it("required: false の項目が空でも登録できる", async () => {
    // 定義側が任意なら、サーバも通すこと（4fd1151 の退行の再発防止）
    const optional = [
      "clStaff",
      "scheduledDate",
      "contractorPartner",
      "postalCode",
      "desiredManufacturer",
    ] as const;
    for (const key of optional) {
      expect(APO_ACQUISITION_FIELD_SPECS[key].required).toBe(false);
    }

    const res = await create(FILLED);

    expect(res.ok).toBe(true);
  });

  it("required: true の項目が空なら弾く", async () => {
    const required = (
      Object.keys(FILLED) as (keyof typeof FILLED)[]
    ).filter((key) => APO_ACQUISITION_FIELD_SPECS[key].required);

    for (const key of required) {
      const res = await create({ ...FILLED, [key]: "" });

      expect(res.ok).toBe(false);
      expect(h.created).toHaveLength(0);
    }
  });
});

describe("★ 商談・資料送付予定日時（4fd1151 で任意にした項目）", () => {
  it("空でも登録できる", async () => {
    const { scheduledDate, ...rest } = { ...FILLED, scheduledDate: "" };
    void scheduledDate;
    const res = await create(rest);

    expect(res).toMatchObject({ ok: true, recordId: "rec-1" });
  });

  it("キー自体が無くても登録できる", async () => {
    const res = await create(FILLED);

    expect(res.ok).toBe(true);
  });

  it("空のときは初回商談予定日を自動セットしない（例外にもしない）", async () => {
    const res = await create({ ...FILLED, scheduledDate: "" });

    expect(res.ok).toBe(true);
    expect(h.created).toHaveLength(1);
    // 初回商談予定日（field-10）には何も入れない
    expect(h.created[0]).not.toHaveProperty("field-10");
  });

  it("入っていれば初回商談予定日へ自動セットする", async () => {
    const res = await create({ ...FILLED, scheduledDate: "2026-09-01T14:00" });

    expect(res.ok).toBe(true);
    expect(JSON.stringify(h.created[0]!["field-10"])).toContain("2026/09/01");
  });
});

describe("★ アポ取得日", () => {
  it("空なら従来どおり弾く", async () => {
    const res = await create({ ...FILLED, apoAcquiredDate: "" });

    expect(res).toMatchObject({
      ok: false,
      status: 400,
      error: "アポ取得日を入力してください",
    });
    expect(h.created).toHaveLength(0);
  });

  it("日付として読めない値も弾く（形式の検証は残す）", async () => {
    const res = await create({ ...FILLED, apoAcquiredDate: "未定" });

    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(h.created).toHaveLength(0);
  });
});

describe("★ 個別の項目", () => {
  it("CL担当者が空でも登録できる", async () => {
    const res = await create({ ...FILLED, clStaff: "" });

    expect(res.ok).toBe(true);
  });

  it("ギフト券が空なら弾く", async () => {
    const res = await create({ ...FILLED, giftCoupon: "" });

    expect(res).toMatchObject({
      ok: false,
      status: 400,
      error: "ギフト券を入力してください",
    });
  });

  it("アポランクが空なら弾く", async () => {
    const res = await create({ ...FILLED, apoRank: "" });

    expect(res).toMatchObject({
      ok: false,
      status: 400,
      error: "アポランクを入力してください",
    });
  });

  it("その他メーカーは「その他」を選んだときだけ必須", async () => {
    const ng = await create({ ...FILLED, desiredManufacturer: "その他" });
    expect(ng).toMatchObject({
      ok: false,
      error: "その他メーカーを入力してください",
    });

    const ok = await create({
      ...FILLED,
      desiredManufacturer: "その他",
      otherManufacturer: "○○電機",
    });
    expect(ok.ok).toBe(true);
  });
});

describe("登録の中身（退行確認）", () => {
  it("見積ステータスの既定値が入る", async () => {
    const res = await create({ ...FILLED, scheduledDate: "" });

    expect(res.ok).toBe(true);
    expect(h.created[0]).toHaveProperty("field-11");
  });

  it("監査ログに渡す record は作成に使った payload と同じ", async () => {
    const res = await create({ ...FILLED, scheduledDate: "" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.audit.appId).toBe("app-apo");
    expect(res.audit.record).toEqual(h.created[0]);
  });
});
