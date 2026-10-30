import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * トラーチ倶楽部の案件で、紹介元を加盟店リストの値だけに限定する（サーバ側）。
 *
 * 加盟店リスト = 取引先会社一覧の 会社種別=トラーチ倶楽部加盟店・取引状況=取引中。
 * 保存のたびにキャッシュを使わず読み直して照合する。
 *
 * 取引先会社一覧の読み込みは本物（trading-partner-manufacturers.ts）を使い、
 * @pocket の呼び出しだけを差し替える。
 */

const CLUB = "トラーチ倶楽部";
const MEMBER = "トラーチ倶楽部加盟店";

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
  /** 取引先会社一覧の行（会社種別 tp-6・取引状況 tp-5・会社名 tp-2） */
  partnerRows: [] as Array<{ record: Record<string, unknown> }>,
  partnerListCalls: 0,
  failPartnerList: false,
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
  apiKeyForTradingPartnerPocket: () => "dummy",
  apiKeyForTradingPartnerPocket1: () => "dummy1",
  fetchAppFieldsTryKeys: async () => null,
  fetchAllRecordsPages: async (appId: string) => {
    if (appId !== "11") throw new Error(`unexpected app ${appId}`);
    h.partnerListCalls += 1;
    if (h.failPartnerList) throw new Error("rate limited");
    return h.partnerRows;
  },
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

function partner(type: string, status: string, name: string) {
  return { record: { "tp-6": type, "tp-5": status, "tp-2": name } };
}

const PARTNERS = [
  partner(MEMBER, "取引中", "アオイ工業"),
  partner(MEMBER, "取引中", "カトウ商店"),
  partner(MEMBER, "取引停止", "サトウ建設"),
  partner("施工店", "取引中", "タナカ施工"),
];

function savedPayload(): Record<string, unknown> {
  expect(h.updateCalls.length).toBeGreaterThan(0);
  return h.updateCalls[0]!.payload;
}

const NOT_MEMBER_MESSAGE =
  "紹介元がトラーチ倶楽部加盟店の一覧にありません。候補から選び直してください。";
const PARTNER_UNREADABLE_MESSAGE =
  "取引先の一覧を確認できなかったため保存できません。時間をおいてもう一度お試しください。";
const REQUIRED_MESSAGE =
  "AP担当者またはCL担当者がトラーチ倶楽部の案件は、紹介元の入力が必須です。紹介元を入力してから保存してください。";

function expectRejected(
  res: { status: number; body: { error?: string } },
  message: string,
) {
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.body.error).toBe(message);
  expect(res.body.error).not.toMatch(/field-|tp-|アプリ|ID/);
  expect(h.updateCalls).toHaveLength(0);
}

beforeEach(() => {
  delete process.env.CUSTOMER_INFO_CONSTRUCTION_LINK_ON_SAVE;
  delete process.env.CUSTOMER_INFO_CONSTRUCTION_HANDLER_FIELD_ID;
  delete process.env.CUSTOMER_INFO_FIELD_REFERRAL_SOURCE;
  process.env.TRADING_PARTNER_APP_ID = "11";
  process.env.TRADING_PARTNER_COMPANY_TYPE_FIELD_ID = "tp-6";
  process.env.TRADING_PARTNER_TRADE_STATUS_FIELD_ID = "tp-5";
  process.env.TRADING_PARTNER_COMPANY_NAME_FIELD_ID = "tp-2";
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
  h.partnerRows = PARTNERS;
  h.partnerListCalls = 0;
  h.failPartnerList = false;
});

describe("★ 加盟店リストと照合する", () => {
  it("リストにある値なら保存できる", async () => {
    const res = await put({ apStaff: CLUB, clStaff: "担当B", referralSource: "アオイ工業" });
    expect(res.status).toBe(200);
    expect(savedPayload()["field-21"]).toBe("アオイ工業");
  });

  it("リストに無い値なら拒否する", async () => {
    const res = await put({ apStaff: CLUB, clStaff: "担当B", referralSource: "A商事" });
    expectRejected(res, NOT_MEMBER_MESSAGE);
  });

  it("取引停止の加盟店・別の会社種別は拒否する", async () => {
    for (const name of ["サトウ建設", "タナカ施工"]) {
      h.updateCalls = [];
      const res = await put({ apStaff: "担当A", clStaff: CLUB, referralSource: name });
      expectRejected(res, NOT_MEMBER_MESSAGE);
    }
  });

  it("全角半角・前後の空白の違いは同じ会社として扱う（画面の候補と同じ比べ方）", async () => {
    h.partnerRows = [partner(MEMBER, "取引中", "ABC設備")];
    const res = await put({ apStaff: CLUB, clStaff: CLUB, referralSource: " ＡＢＣ設備 " });
    expect(res.status).toBe(200);
  });

  it("★ 既存レコードの紹介元がリストに無ければ、他の項目だけの保存も拒否する", async () => {
    h.before["field-3"] = CLUB;
    h.before["field-21"] = "A商事";
    const res = await put({ phone: "1" });
    expectRejected(res, NOT_MEMBER_MESSAGE);
  });
});

describe("★ 保存のたびに一覧を読み直す（キャッシュを使わない）", () => {
  it("保存するたびに取引先会社一覧を読む", async () => {
    await put({ apStaff: CLUB, clStaff: "担当B", referralSource: "アオイ工業" });
    await put({ apStaff: CLUB, clStaff: "担当B", referralSource: "アオイ工業" });
    expect(h.partnerListCalls).toBe(2);
  });

  it("加盟店を登録した直後でも保存できる", async () => {
    const first = await put({ apStaff: CLUB, clStaff: "担当B", referralSource: "ワタナベ電設" });
    expect(first.status).toBe(400);

    h.partnerRows = [...PARTNERS, partner(MEMBER, "取引中", "ワタナベ電設")];
    const second = await put({ apStaff: CLUB, clStaff: "担当B", referralSource: "ワタナベ電設" });
    expect(second.status).toBe(200);
  });

  it("画面用の一覧（キャッシュ）があっても、保存は読み直した一覧で照合する", async () => {
    const tp = await import("@/lib/trading-partner-manufacturers");
    expect(await tp.fetchTradingPartnerClubMemberOptions()).toEqual([
      "アオイ工業",
      "カトウ商店",
    ]);
    h.partnerRows = [partner(MEMBER, "取引中", "カトウ商店")];
    const res = await put({ apStaff: CLUB, clStaff: "担当B", referralSource: "アオイ工業" });
    expectRejected(res, NOT_MEMBER_MESSAGE);
  });
});

describe("★ 一覧が読めないときは保存できない", () => {
  it("読み直しに失敗したら拒否する", async () => {
    h.failPartnerList = true;
    const res = await put({ apStaff: CLUB, clStaff: "担当B", referralSource: "アオイ工業" });
    expectRejected(res, PARTNER_UNREADABLE_MESSAGE);
  });

  it("取引先会社一覧が未設定でも拒否する", async () => {
    delete process.env.TRADING_PARTNER_APP_ID;
    const res = await put({ apStaff: CLUB, clStaff: "担当B", referralSource: "アオイ工業" });
    expectRejected(res, PARTNER_UNREADABLE_MESSAGE);
  });

  it("加盟店が1件も取れなかったときも、確認できなかった扱いにする", async () => {
    h.partnerRows = [];
    const res = await put({ apStaff: CLUB, clStaff: "担当B", referralSource: "アオイ工業" });
    expectRejected(res, PARTNER_UNREADABLE_MESSAGE);
  });

  it("★ そのときの文言は「リストに無い」ではない", () => {
    expect(PARTNER_UNREADABLE_MESSAGE).not.toMatch(/ありません|無い|ない/);
    expect(PARTNER_UNREADABLE_MESSAGE).toContain("確認できなかった");
  });
});

describe("★ 照合しない案件", () => {
  it("トラーチ倶楽部でない案件は照合しない（一覧も読まない）", async () => {
    const res = await put({
      apStaff: "担当A",
      clStaff: "担当B",
      introduction: "お客様紹介",
      referralSource: "A商事",
    });
    expect(res.status).toBe(200);
    expect(h.partnerListCalls).toBe(0);
  });

  it("キャンセル案件は照合しない（一覧も読まない）", async () => {
    const res = await put({
      customerStatus: "キャンセル",
      apStaff: CLUB,
      clStaff: CLUB,
      referralSource: "A商事",
      pt: "1200",
    });
    expect(res.status).toBe(200);
    expect(h.partnerListCalls).toBe(0);
  });
});

describe("★ 空なら拒否する動きは変わらない", () => {
  it("空なら必須の文言で拒否し、一覧は読まない", async () => {
    const res = await put({ apStaff: CLUB, clStaff: "担当B", referralSource: "" });
    expectRejected(res, REQUIRED_MESSAGE);
    expect(h.partnerListCalls).toBe(0);
  });
});
