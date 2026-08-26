import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * @pocket が作成レコードの ID を返さない件。
 *
 * 実機の Netlify ログで location=null / hasRawBody=false を確認済み。
 * ヘッダにも本文にも手がかりが無いため、作成前後の一覧を突き合わせて
 * 「増えた1件」を採る。
 *
 * ここで固定するのは次の2点。
 *   - 特定できなくても**登録は成功として返す**
 *     （失敗と伝えると利用者が押し直し、重複レコードが増える）
 *   - 特定に自信が持てないときは**特定しない**
 *     （別レコードに添付が付き共有リンクが上書きされる事故を防ぐ）
 */

const h = vi.hoisted(() => ({
  /** createRecord の応答。既定は ID を返さない実機の挙動 */
  createResult: { row: {}, location: null, recordIdHint: null, rawBody: null } as
    Record<string, unknown>,
  /** 一覧の応答を呼ばれた順に返す */
  listQueue: [] as unknown[],
  listCalls: [] as (string | undefined)[],
  listThrows: false,
  createCalls: 0,
  updated: [] as { recordId: string; patch: Record<string, unknown> }[],
  updateThrows: false,
}));

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
  fetchRecordsList: async (
    _appId: string,
    params?: { query?: string },
  ) => {
    h.listCalls.push(params?.query);
    if (h.listThrows) throw new Error("429 Too Many Requests");
    return h.listQueue.shift() ?? { records: [] };
  },
  createRecord: async () => {
    h.createCalls += 1;
    return h.createResult;
  },
  updateRecord: async (
    _appId: string,
    recordId: string,
    patch: Record<string, unknown>,
  ) => {
    if (h.updateThrows) throw new Error("@pocket update record failed: 500");
    h.updated.push({ recordId, patch });
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
    cl: { options: [] },
  }),
}));

vi.mock("@/lib/dropbox", () => ({ dropboxApoConfigured: () => false }));

const { createApoAcquisitionRecord } = await import(
  "@/lib/apo-acquisition-server"
);

const VALUES = {
  apStaff: "西村 直也",
  apoAcquiredDate: "2026-08-26",
  giftCoupon: "有",
  apoRank: "A",
  apoType: "新規",
  estimateType: "概算",
  customerName: "山田 太郎",
};

const rows = (...ids: number[]) => ({
  records: ids.map((id) => ({ recordId: id, record: {} })),
});

function create() {
  return createApoAcquisitionRecord("西村 直也", {
    apStaffName: "西村 直也",
    values: VALUES,
  });
}

beforeEach(() => {
  h.createResult = {
    row: {},
    location: null,
    recordIdHint: null,
    rawBody: null,
  };
  h.listQueue = [];
  h.listCalls = [];
  h.listThrows = false;
  h.createCalls = 0;
  h.updated = [];
  h.updateThrows = false;
});

describe("★ ID が返ってくる場合（従来の流れ）", () => {
  it("一覧照合をせずにその ID を使う", async () => {
    h.createResult = {
      row: { recordId: 12 },
      location: null,
      recordIdHint: null,
      rawBody: null,
    };
    // 作成前の1回だけ。作成後は照合しない
    h.listQueue = [rows(10)];

    const res = await create();

    expect(res).toMatchObject({ ok: true, recordId: "12" });
    expect(h.listCalls).toHaveLength(1);
  });

  it("Location ヘッダからでも従来どおり取れる", async () => {
    h.createResult = {
      row: {},
      location: "/api/apps/app-apo/records/34",
      recordIdHint: "34",
      rawBody: null,
    };
    h.listQueue = [rows()];

    const res = await create();

    expect(res).toMatchObject({ ok: true, recordId: "34" });
  });
});

describe("★ ID が返らない場合（実機の挙動）", () => {
  it("作成前後の差分で特定できる", async () => {
    h.listQueue = [rows(10, 11), rows(10, 11, 12)];

    const res = await create();

    expect(res).toMatchObject({ ok: true, recordId: "12" });
    expect(h.listCalls).toHaveLength(2);
    // 一覧はお客様名で絞る
    expect(h.listCalls[0]).toContain("山田 太郎");
  });

  it("★ 同姓同名の既存レコードは掴まない", async () => {
    // 既に「山田 太郎」の行があるが、作成した行がまだ見えていない
    h.listQueue = [rows(10), rows(10)];

    const res = await create();

    // 既存の 10 に添付を付けたら実データを壊す。特定しないのが正解
    expect(res).toMatchObject({ ok: true, recordId: "" });
  });

  it("★ 2件以上増えていたら特定しない", async () => {
    h.listQueue = [rows(10), rows(10, 11, 12)];

    const res = await create();

    expect(res).toMatchObject({ ok: true, recordId: "" });
  });

  it("★ 一覧が取れなくても登録は成功として返す", async () => {
    h.listThrows = true;

    const res = await create();

    expect(res).toMatchObject({ ok: true, recordId: "" });
    expect(h.createCalls).toBe(1);
  });

  it("★ 特定できなくても失敗にしない（重複登録を招くため）", async () => {
    h.listQueue = [rows(), rows()];

    const res = await create();

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.recordId).toBe("");
    // 監査ログは残せる。列見出しも付ける
    expect(res.audit.appId).toBe("app-apo");
    expect(Object.keys(res.audit.record).length).toBeGreaterThan(0);
    expect(res.audit.labels["field-9"]).toBe("お客様名");
  });

  it("★ createRecord は1回だけ。照合のために作り直さない", async () => {
    h.listQueue = [rows(10), rows(10)];

    await create();

    expect(h.createCalls).toBe(1);
  });
});

describe("★ 作成後に失敗しても登録は成功として返す", () => {
  it("担当者の関連付けが落ちても ok: true", async () => {
    h.createResult = {
      row: { recordId: 12 },
      location: null,
      recordIdHint: null,
      rawBody: null,
    };
    h.listQueue = [rows()];
    h.updateThrows = true;

    const res = await create();

    // レコードは既にある。502 を返すと押し直しで重複が増える
    expect(res).toMatchObject({ ok: true, recordId: "12" });
  });
});

describe("退行確認", () => {
  it("必須が空なら従来どおり弾き、createRecord も呼ばない", async () => {
    const res = await createApoAcquisitionRecord("西村 直也", {
      apStaffName: "西村 直也",
      values: { ...VALUES, giftCoupon: "" },
    });

    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(h.createCalls).toBe(0);
    // 弾いた時点では一覧も引かない
    expect(h.listCalls).toHaveLength(0);
  });

  it("見積ステータスの既定値は入ったまま", async () => {
    h.createResult = {
      row: { recordId: 12 },
      location: null,
      recordIdHint: null,
      rawBody: null,
    };
    h.listQueue = [rows()];

    const res = await create();

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.audit.record).toHaveProperty("field-11");
  });
});
