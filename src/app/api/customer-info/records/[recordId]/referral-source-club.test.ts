import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * トラーチ倶楽部の案件で紹介元を必須にする（サーバ側の拒否）。
 *
 * 画面の必須チェックを通らない保存（API を直接叩く・項目を一部だけ送る）でも、
 * 保存後に AP/CL のどちらかがトラーチ倶楽部で紹介元が空なら拒否する。
 *
 * 汎用の必須チェックはここでは外す（送った値だけでなく、保存前の
 * @pocket の値も見て拒否することを確かめるため）。
 */

const CLUB = "トラーチ倶楽部";

const h = vi.hoisted(() => ({
  /** 保存前レコード */
  before: {} as Record<string, string>,
  updateCalls: [] as Array<{ appId: string; payload: Record<string, unknown> }>,
  fetchCalls: [] as Array<{ appId: string; csv?: string }>,
  linkCalls: 0,
  /** 紹介元の列を含めるか（列が見つからないときの確認用） */
  withReferralColumn: true,
  /** 紹介元の列だけを読むときに失敗させる */
  failReferralRead: false,
}));

const APP_FIELDS = [
  { uniqueId: "field-1", caption: "T番号" },
  { uniqueId: "field-2", caption: "お客様名" },
  { uniqueId: "field-3", caption: "AP担当者" },
  { uniqueId: "field-4", caption: "CL担当者" },
  { uniqueId: "field-5", caption: "入力ステータス" },
  { uniqueId: "field-6", caption: "顧客ステータス" },
  { uniqueId: "field-7", caption: "施工予定日" },
  { uniqueId: "field-8", caption: "初回施工予定日" },
  { uniqueId: "field-9", caption: "施工業者" },
  { uniqueId: "field-10", caption: "工事対応者" },
  { uniqueId: "field-11", caption: "APPT" },
  { uniqueId: "field-12", caption: "CLPT" },
  { uniqueId: "field-13", caption: "電話番号" },
  { uniqueId: "field-14", caption: "Aki番号" },
  { uniqueId: "field-20", caption: "導入経緯" },
  { uniqueId: "field-30", caption: "紹介元（新）" },
];
const REFERRAL_FIELD = { uniqueId: "field-21", caption: "紹介元" };

vi.mock("@/lib/request-auth", () => ({
  resolveCallerLineAuth: async () => ({ ok: true, lineUserId: "U-test" }),
  lineAuthUnauthorizedResponse: () => new Response(null, { status: 401 }),
}));

vi.mock("@/lib/customer-info-config", () => ({
  customerInfoConfigReady: () => ({
    ok: true,
    appId: "35",
    nameFieldId: "field-2",
  }),
  customerInfoEditableFieldIds: () => [],
  customerInfoPocketAuth: () => ({ apiKey: "dummy" }),
  customerInfoPocketAuth1: () => ({ apiKey: "dummy" }),
  customerInfoPocketAuthWrite: () => ({ apiKey: "dummy" }),
  customerInfoSubtitleFieldId: () => "",
  customerInfoUsesLegacyEditableList: () => false,
  customerInfoImportKeyFieldId: () => "",
  customerInfoImportKeySourceFieldIds: () => [],
  customerInfoNameFieldId: () => "field-2",
  customerInfoAppId: () => "35",
  customerInfoCustomerStatusFieldId: () => "",
}));

vi.mock("@/lib/atpocket", () => ({
  fetchAppFields: async () =>
    h.withReferralColumn ? [...APP_FIELDS, REFERRAL_FIELD] : APP_FIELDS,
  fetchRecordById: async (
    appId: string,
    _recordId: string,
    _auth: unknown,
    csv?: string,
  ) => {
    h.fetchCalls.push({ appId, csv });
    if (h.failReferralRead && (csv === "field-21" || csv === "field-30")) {
      throw new Error("read failed");
    }
    return { record: { ...h.before } };
  },
  updateRecord: async (
    appId: string,
    _recordId: string,
    payload: Record<string, unknown>,
  ) => {
    h.updateCalls.push({ appId, payload });
  },
}));

vi.mock("@/lib/customer-cancel-server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/customer-cancel-server")>();
  return {
    applyCustomerCancelToPayload: actual.applyCustomerCancelToPayload,
    runCustomerCancelSideEffects: async () => ({
      warnings: [],
      constructionUpdated: true,
      constructionDeleted: false,
    }),
  };
});

vi.mock("@/lib/customer-info-construction-link", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/customer-info-construction-link")>();
  return {
    ...actual,
    linkCustomerInfoToConstruction: async () => {
      h.linkCalls += 1;
      return { kind: "skipped", reason: "test" };
    },
  };
});

// 必須項目のチェックはここでは見ない（テストの保存を最小の項目で済ませるため）
vi.mock("@/lib/customer-info-form/validate", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/customer-info-form/validate")>();
  return { ...actual, findMissingRequiredCustomerInfoFields: () => [] };
});

vi.mock("@/lib/audit-log", () => ({
  auditLogEnabled: () => false,
  recordAuditLog: async () => ({ ok: true, written: 0 }),
}));

vi.mock("@/lib/dropbox", () => ({ dropboxConfigured: () => false }));

vi.mock("@/lib/customer-info-dropbox-link", () => ({
  applyDropboxFolderRenameToPayload: async () => undefined,
  resolveCustomerInfoDropboxLinkFieldId: () => null,
}));

vi.mock("@/lib/customer-info-pending-cache", () => ({
  invalidateCustomerInfoPendingCache: () => {},
}));

vi.mock("@/lib/customer-info-key-lookup-cache", () => ({
  invalidateCustomerInfoKeyLookupCache: () => {},
}));

vi.mock("@/lib/staff-workplace-lookup", () => ({
  resolveStaffWorkplaceLookupConfig: async () => null,
  lookupStaffWorkplaceByStaffName: async () => null,
  resolveStaffAssignmentLookupConfig: async () => null,
  lookupStaffAssignmentByStaffName: async () => ({}),
}));

vi.mock("@/lib/product-catalog-models", () => ({
  lookupBatteryModelNumberByCapacity: async () => null,
}));

vi.mock("@/lib/google-chat", () => ({
  googleChatContractWebhookConfigured: () => false,
  sendGoogleChatContractMessage: async () => ({ kind: "sent" as const }),
}));

const { PUT } = await import(
  "@/app/api/customer-info/records/[recordId]/route"
);

const ctx = { params: Promise.resolve({ recordId: "1483" }) };

async function put(formValues: Record<string, unknown>) {
  const res = await PUT(
    new Request("https://example.test/records/1483", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formValues }),
    }),
    ctx,
  );
  return {
    status: res.status,
    body: (await res.json()) as { ok?: boolean; error?: string },
  };
}

/** 保存したペイロード（1回目の更新） */
function savedPayload(): Record<string, unknown> {
  expect(h.updateCalls.length).toBeGreaterThan(0);
  return h.updateCalls[0]!.payload;
}

/** 紹介元の列だけを読んだ回数 */
function referralOnlyFetchCount(): number {
  return h.fetchCalls.filter((c) => c.csv === "field-21" || c.csv === "field-30")
    .length;
}

const REQUIRED_MESSAGE =
  "AP担当者またはCL担当者がトラーチ倶楽部の案件は、紹介元の入力が必須です。紹介元を入力してから保存してください。";
const COLUMN_MISSING_MESSAGE =
  "紹介元の欄が見つからないため保存できません。管理者に連絡してください。";

function expectRejected(
  res: { status: number; body: { error?: string } },
  message: string,
) {
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.body.error).toBe(message);
  // 内部の事情（列番号）を出さない
  expect(res.body.error).not.toMatch(/field-/);
  expect(h.updateCalls).toHaveLength(0);
}

beforeEach(() => {
  delete process.env.CUSTOMER_INFO_CONSTRUCTION_LINK_ON_SAVE;
  delete process.env.CUSTOMER_INFO_CONSTRUCTION_HANDLER_FIELD_ID;
  delete process.env.CUSTOMER_INFO_FIELD_REFERRAL_SOURCE;
  h.before = {
    "field-1": "T00000001",
    "field-3": "担当A",
    "field-4": "担当B",
    "field-6": "工事待ち",
    "field-10": "",
    "field-20": "ダイレクト",
    "field-21": "",
    "field-30": "",
  };
  h.updateCalls = [];
  h.fetchCalls = [];
  h.linkCalls = 0;
  h.withReferralColumn = true;
  h.failReferralRead = false;
});

describe("★ 空のまま保存するとサーバが拒否する", () => {
  it("AP をトラーチ倶楽部にして紹介元を送らない", async () => {
    const res = await put({ apStaff: CLUB, clStaff: "担当B", phone: "1" });
    expectRejected(res, REQUIRED_MESSAGE);
  });

  it("CL をトラーチ倶楽部にして紹介元を空で送る", async () => {
    const res = await put({
      apStaff: "担当A",
      clStaff: CLUB,
      introduction: "お客様紹介",
      referralSource: "  ",
    });
    expectRejected(res, REQUIRED_MESSAGE);
  });

  it("両方トラーチ倶楽部でも拒否する", async () => {
    const res = await put({ apStaff: CLUB, clStaff: CLUB, phone: "1" });
    expectRejected(res, REQUIRED_MESSAGE);
  });

  it("★ 既存レコードが条件に当てはまり紹介元が空なら、他の項目だけの保存も拒否する", async () => {
    h.before["field-3"] = CLUB;
    // API を直接叩き、AP/CL・紹介元を送らない
    const res = await put({ phone: "090-0000-0000" });
    expectRejected(res, REQUIRED_MESSAGE);
  });
});

describe("紹介元が入っていれば保存できる", () => {
  it("★ 条件A の対象外でも、送った紹介元を書き込む", async () => {
    const res = await put({
      apStaff: CLUB,
      clStaff: "担当B",
      introduction: "ダイレクト",
      referralSource: "A商事",
    });
    expect(res.status).toBe(200);
    expect(savedPayload()["field-21"]).toBe("A商事");
  });

  it("★ 保存前から紹介元が入っていれば、送らなくても通る", async () => {
    h.before["field-3"] = CLUB;
    h.before["field-4"] = CLUB;
    h.before["field-21"] = "A商事";
    const res = await put({ phone: "1" });
    expect(res.status).toBe(200);
    expect(savedPayload()).not.toHaveProperty("field-21");
  });
});

describe("★ どちらもトラーチ倶楽部でなければ必須でない", () => {
  it("紹介元が空でも保存でき、紹介元の列を読みに行かない", async () => {
    const res = await put({ apStaff: "担当A", clStaff: "担当B", phone: "1" });
    expect(res.status).toBe(200);
    expect(referralOnlyFetchCount()).toBe(0);
  });
});

describe("★ 担当者を変えたとき", () => {
  it("トラーチ倶楽部以外に変えたら必須でなくなり、紹介元を消さない", async () => {
    h.before["field-3"] = CLUB;
    h.before["field-21"] = "A商事";
    const res = await put({
      apStaff: "担当A",
      clStaff: "担当B",
      introduction: "ダイレクト",
      referralSource: "A商事",
    });
    expect(res.status).toBe(200);
    const payload = savedPayload();
    expect(payload["field-3"]).toBe("担当A");
    // 紹介元は空や「-」で上書きしない（@pocket の値が残る）
    expect(payload).not.toHaveProperty("field-21");
  });

  it("紹介元が空のレコードでも、条件から外れる保存は通る", async () => {
    h.before["field-3"] = CLUB;
    const res = await put({ apStaff: "担当A", clStaff: "担当B", phone: "1" });
    expect(res.status).toBe(200);
  });
});

describe("★ 列が見つからないとき", () => {
  it("トラーチ倶楽部の案件は保存を止める", async () => {
    h.withReferralColumn = false;
    const res = await put({ apStaff: CLUB, clStaff: "担当B", phone: "1" });
    expectRejected(res, COLUMN_MISSING_MESSAGE);
  });

  it("トラーチ倶楽部でない案件は従来どおり保存できる", async () => {
    h.withReferralColumn = false;
    const res = await put({ apStaff: "担当A", clStaff: "担当B", phone: "1" });
    expect(res.status).toBe(200);
  });
});

describe("列の決め方（環境変数 → 見出し）", () => {
  it("★ 環境変数で指定した列を紹介元として見る", async () => {
    process.env.CUSTOMER_INFO_FIELD_REFERRAL_SOURCE = "field-30";
    h.before["field-3"] = CLUB;
    // 見出し「紹介元」の列に値があっても、環境変数の列が空なら拒否する
    h.before["field-21"] = "A商事";
    const res = await put({ phone: "1" });
    expectRejected(res, REQUIRED_MESSAGE);
  });

  it("環境変数の列に送った紹介元を書き込む", async () => {
    process.env.CUSTOMER_INFO_FIELD_REFERRAL_SOURCE = "field-30";
    const res = await put({ apStaff: CLUB, clStaff: "担当B", referralSource: "B商事" });
    expect(res.status).toBe(200);
    expect(savedPayload()["field-30"]).toBe("B商事");
  });
});

describe("紹介元を確認できないとき", () => {
  it("保存前の紹介元を読めなければ保存を止める", async () => {
    h.before["field-3"] = CLUB;
    h.failReferralRead = true;
    const res = await put({ phone: "1" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.error).toContain("紹介元");
    expect(res.body.error).not.toMatch(/field-/);
    expect(h.updateCalls).toHaveLength(0);
  });
});

describe("キャンセルは他の必須と同じく対象外", () => {
  it("キャンセルにする保存は紹介元が空でも通る", async () => {
    const res = await put({
      customerStatus: "キャンセル",
      apStaff: CLUB,
      clStaff: CLUB,
      pt: "1200",
    });
    expect(res.status).toBe(200);
  });
});
