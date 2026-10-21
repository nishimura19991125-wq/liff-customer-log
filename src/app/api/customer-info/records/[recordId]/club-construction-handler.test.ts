import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AP・CL が両方トラーチ倶楽部なら、空の工事対応者に「トラーチ倶楽部」を入れる
 * （契約情報入力の保存時・お客様情報アプリだけ）。
 *
 * payload の組み立て（AP/CL の送信ガードを含む）とキャンセルの反映は本物を使う。
 */

const CLUB = "トラーチ倶楽部";

const h = vi.hoisted(() => ({
  /** 保存前レコード */
  before: {} as Record<string, string>,
  updateCalls: [] as Array<{ appId: string; payload: Record<string, unknown> }>,
  fetchCalls: [] as Array<{ appId: string; csv?: string }>,
  linkCalls: 0,
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
];

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
  fetchAppFields: async () => APP_FIELDS,
  fetchRecordById: async (
    appId: string,
    _recordId: string,
    _auth: unknown,
    csv?: string,
  ) => {
    h.fetchCalls.push({ appId, csv });
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
  return { status: res.status, body: (await res.json()) as { ok?: boolean } };
}

/** 保存したペイロード（1回目の更新） */
function savedPayload(): Record<string, unknown> {
  expect(h.updateCalls.length).toBeGreaterThan(0);
  return h.updateCalls[0]!.payload;
}

/** 工事対応者の列だけを読んだ回数 */
function handlerOnlyFetchCount(): number {
  return h.fetchCalls.filter((c) => c.csv === "field-10").length;
}

beforeEach(() => {
  delete process.env.CUSTOMER_INFO_CONSTRUCTION_LINK_ON_SAVE;
  delete process.env.CUSTOMER_INFO_CONSTRUCTION_HANDLER_FIELD_ID;
  h.before = {
    "field-1": "T00000001",
    "field-3": "",
    "field-4": "",
    "field-6": "工事待ち",
    "field-10": "",
  };
  h.updateCalls = [];
  h.fetchCalls = [];
  h.linkCalls = 0;
});

describe("★ AP・CL が両方トラーチ倶楽部で工事対応者が空", () => {
  it("工事対応者にトラーチ倶楽部が入る", async () => {
    const { status } = await put({ apStaff: CLUB, clStaff: CLUB, phone: "090-0000-0000" });

    expect(status).toBe(200);
    expect(savedPayload()["field-10"]).toBe(CLUB);
  });

  it("AP/CL が保存前から両方トラーチ倶楽部（payload に載らない）でも入る", async () => {
    h.before["field-3"] = CLUB;
    h.before["field-4"] = CLUB;

    await put({ apStaff: CLUB, clStaff: CLUB, phone: "090-0000-0000" });

    const payload = savedPayload();
    // 変わっていない AP/CL は送らない（既存のガード）
    expect(payload).not.toHaveProperty("field-3");
    expect(payload).not.toHaveProperty("field-4");
    expect(payload["field-10"]).toBe(CLUB);
  });

  it("前後に空白があっても一致する", async () => {
    await put({ apStaff: `  ${CLUB} `, clStaff: `${CLUB}　`, phone: "1" });

    expect(savedPayload()["field-10"]).toBe(CLUB);
  });

  it("全角半角の違いがあっても一致する", async () => {
    await put({ apStaff: "ﾄﾗｰﾁ倶楽部", clStaff: CLUB, phone: "1" });

    expect(savedPayload()["field-10"]).toBe(CLUB);
  });
});

describe("★ 既存の工事対応者は上書きしない", () => {
  it("工事対応者に値があれば payload に載せない", async () => {
    h.before["field-10"] = "担当C";

    await put({ apStaff: CLUB, clStaff: CLUB, phone: "1" });

    expect(savedPayload()).not.toHaveProperty("field-10");
  });
});

describe("★ 条件を満たさなければ何もしない", () => {
  const cases: Array<[string, Record<string, string>]> = [
    ["AP だけがトラーチ倶楽部", { apStaff: CLUB, clStaff: "担当B" }],
    ["CL だけがトラーチ倶楽部", { apStaff: "担当A", clStaff: CLUB }],
    ["AP・CL が両方とも別の人", { apStaff: "担当A", clStaff: "担当A" }],
    ["AP が空", { apStaff: "", clStaff: CLUB }],
    ["CL が空", { apStaff: CLUB, clStaff: "" }],
  ];

  for (const [name, staff] of cases) {
    it(name, async () => {
      await put({ ...staff, phone: "1" });

      expect(savedPayload()).not.toHaveProperty("field-10");
      // 普段の保存では工事対応者を読みに行かない
      expect(handlerOnlyFetchCount()).toBe(0);
    });
  }
});

describe("★ 工事登録アプリには書き込まない", () => {
  it("読み書きはすべてお客様情報アプリ", async () => {
    await put({ apStaff: CLUB, clStaff: CLUB, phone: "1" });

    expect(savedPayload()["field-10"]).toBe(CLUB);
    expect(h.updateCalls).toHaveLength(1);
    expect(h.updateCalls.every((c) => c.appId === "35")).toBe(true);
    expect(h.fetchCalls.every((c) => c.appId === "35")).toBe(true);
    expect(h.linkCalls).toBe(0);
  });
});

describe("★ キャンセル時に工事対応者を空にする挙動は変わらない", () => {
  const CANCEL = {
    customerStatus: "キャンセル",
    apStaff: CLUB,
    clStaff: CLUB,
    pt: "1200",
  };

  it("キャンセルにする保存では空文字のまま", async () => {
    await put(CANCEL);

    expect(savedPayload()["field-10"]).toBe("");
  });

  it("キャンセル済みの再保存でも自動で入れない", async () => {
    h.before["field-6"] = "キャンセル";

    await put(CANCEL);

    expect(savedPayload()).not.toHaveProperty("field-10");
  });
});
