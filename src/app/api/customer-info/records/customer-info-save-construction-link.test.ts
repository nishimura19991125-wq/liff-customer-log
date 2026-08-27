import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * お客様情報の保存から工事登録アプリへ連携するかの切り替え。
 *
 * 第2段階で「施工予定日を入れたら工事登録アプリへ載せる」を実装したが、
 * 施工予定日の割り当ては工事カレンダーからのみ行う方針に変わったため、
 * **既定では連携しない**。
 *
 * 処理そのものは第3段階で一部を再利用する見込みがあるので消していない。
 * ここで固定するのは「既定で呼ばれないこと」と「戻すときの入口」。
 */

const h = vi.hoisted(() => ({
  linkCalls: [] as Record<string, unknown>[],
  /** 保存前レコードの取得で要求された列（CSV） */
  fetchedCsv: [] as (string | undefined)[],
  updated: [] as Record<string, unknown>[],
}));

const APP_FIELDS = [
  { uniqueId: "field-268", caption: "T番号" },
  { uniqueId: "field-2", caption: "お客様名" },
  { uniqueId: "field-9", caption: "施工予定日" },
  { uniqueId: "field-5", caption: "住宅ステータス" },
  { uniqueId: "field-6", caption: "工事対応者" },
];

/** フォームの解決結果。保存に要る最低限だけ */
const RESOLVED = [
  { key: "apStaff", fieldId: "field-11", label: "AP担当者", type: "text" },
  { key: "clStaff", fieldId: "field-12", label: "CL担当者", type: "text" },
  {
    key: "constructionDate",
    fieldId: "field-9",
    label: "施工予定日",
    type: "date",
  },
  { key: "customerName", fieldId: "field-2", label: "お客様名", type: "text" },
];

vi.mock("@/lib/request-auth", () => ({
  resolveCallerLineAuth: async () => ({ ok: true, lineUserId: "U1" }),
  lineAuthUnauthorizedResponse: () =>
    new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
}));

vi.mock("@/lib/customer-info-config", () => ({
  customerInfoConfigReady: () => ({ ok: true, appId: "app-cust" }),
  customerInfoEditableFieldIds: () => [],
  customerInfoImportKeyFieldId: () => "field-268",
  customerInfoPocketAuth: () => ({ apiKey: "r" }),
  customerInfoPocketAuth1: () => ({ apiKey: "r1" }),
  customerInfoPocketAuthWrite: () => ({ apiKey: "w" }),
  customerInfoSubtitleFieldId: () => null,
  customerInfoUsesLegacyEditableList: () => false,
}));

vi.mock("@/lib/atpocket", () => ({
  fetchAppFields: async () => APP_FIELDS,
  fetchRecordById: async (
    _appId: string,
    _recordId: string,
    _auth: unknown,
    csv?: string,
  ) => {
    h.fetchedCsv.push(csv);
    return { record: { "field-268": "T00003420", "field-9": "" } };
  },
  updateRecord: async (
    _appId: string,
    _recordId: string,
    payload: Record<string, unknown>,
  ) => {
    h.updated.push(payload);
  },
}));

vi.mock("@/lib/customer-info-construction-link", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/customer-info-construction-link")
  >("@/lib/customer-info-construction-link");
  return {
    // 切り替えの実物を使う（既定 false / env で true）
    customerInfoConstructionLinkOnSaveEnabled:
      actual.customerInfoConstructionLinkOnSaveEnabled,
    linkCustomerInfoToConstruction: async (o: Record<string, unknown>) => {
      h.linkCalls.push(o);
      return { kind: "created", recordId: "con-1", akiNumber: "A0001" };
    },
  };
});

vi.mock("@/lib/customer-info-form/resolve-fields", () => ({
  formValuesFromPutBody: (incoming: Record<string, unknown>) => incoming,
  normalizeDateForInput: (v: string) => v,
  readCustomerInfoFormValuesFromRecord: () => ({}),
  resolveCustomerInfoFormFieldId: () => null,
  resolveCustomerInfoFormFields: () => ({ resolved: RESOLVED }),
  resolveCustomerInfoPtTransferFields: () => [],
}));

vi.mock("@/lib/customer-info-form/name-parts", () => ({
  expandNamePartsInValues: (v: Record<string, unknown>) => v,
  syncCombinedNameFields: (v: Record<string, unknown>) => v,
}));

vi.mock("@/lib/customer-info-form/validate", () => ({
  findMissingRequiredCustomerInfoFields: () => [],
  formatCustomerInfoRequiredValidationError: () => "",
}));

vi.mock("@/lib/customer-info-form/put-payload", () => ({
  attachCustomerInfoImportKeyToPayload: async () => ({ ok: true }),
  formPayloadFromValues: async () => ({ "field-9": "2026-12-01" }),
}));

vi.mock("@/lib/contract-notification-server", () => ({
  contractNotificationExtraFieldIdList: () => ["field-268"],
  notifyContractCompleted: async () => ({ kind: "skipped" }),
  readContractNotificationExtraValues: () => ({
    tNumber: "T00003420",
    batteryLocation: "",
  }),
  resolveContractNotificationExtraFieldIds: () => ({
    tNumber: "field-268",
    batteryLocation: null,
  }),
}));

vi.mock("@/lib/customer-cancel-server", () => ({
  applyCustomerCancelToPayload: () => {},
  runCustomerCancelSideEffects: async () => ({
    warnings: [],
    constructionUpdated: false,
    emptySlotCreated: false,
  }),
}));

vi.mock("@/lib/audit-log", () => ({
  auditLogEnabled: () => false,
  recordAuditLog: async () => ({ ok: true }),
}));

vi.mock("@/lib/customer-info-pending-cache", () => ({
  invalidateCustomerInfoPendingCache: () => {},
}));
vi.mock("@/lib/customer-info-key-lookup-cache", () => ({
  invalidateCustomerInfoKeyLookupCache: () => {},
}));
vi.mock("@/lib/customer-info-dropbox-link", () => ({
  applyDropboxFolderRenameToPayload: async () => {},
  renameCustomerFolderLink: async () => null,
  resolveCustomerInfoDropboxLinkFieldId: () => null,
}));
vi.mock("@/lib/dropbox", () => ({ dropboxConfigured: () => false }));
vi.mock("@/lib/trading-partner-manufacturers", () => ({
  enrichCustomerInfoFormFieldsWithManufacturers: async (f: unknown) => f,
}));
vi.mock("@/lib/customer-document-upload", () => ({
  documentUploadMaxBytes: () => 5_000_000,
}));

const { PUT } = await import(
  "@/app/api/customer-info/records/[recordId]/route"
);

function put(values: Record<string, unknown>) {
  return PUT(
    new Request("https://example.test/api/customer-info/records/r1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formValues: values }),
    }),
    { params: Promise.resolve({ recordId: "r1" }) },
  );
}

beforeEach(() => {
  delete process.env.CUSTOMER_INFO_CONSTRUCTION_LINK_ON_SAVE;
  h.linkCalls = [];
  h.fetchedCsv = [];
  h.updated = [];
});

describe("★ 既定では工事登録アプリへ連携しない", () => {
  it("施工予定日を入れて保存しても工事アプリを触らない", async () => {
    const res = await put({ constructionDate: "2026-12-01" });

    expect(res.status).toBe(200);
    expect(h.linkCalls).toHaveLength(0);
  });

  it("★ 保存前レコードの取得に連携用の列を足さない", async () => {
    await put({ constructionDate: "2026-12-01" });

    const csv = h.fetchedCsv.filter(Boolean).join(",");
    // 施工予定日・住宅ステータス・工事対応者は連携のためだけに読んでいた
    expect(csv).not.toContain("field-9");
    expect(csv).not.toContain("field-5");
    expect(csv).not.toContain("field-6");
  });

  it("お客様情報の保存そのものは従来どおり動く", async () => {
    const res = await put({ constructionDate: "2026-12-01" });

    expect(await res.json()).toMatchObject({ ok: true });
    expect(h.updated.length).toBeGreaterThan(0);
  });

  it("Aki番号 の書き戻しも行わない", async () => {
    await put({ constructionDate: "2026-12-01" });

    // 保存そのもの以外の PUT は発生しない
    expect(h.updated).toHaveLength(1);
  });
});

describe("★ 環境変数で元に戻せる", () => {
  beforeEach(() => {
    process.env.CUSTOMER_INFO_CONSTRUCTION_LINK_ON_SAVE = "true";
  });

  it("true のときは連携する", async () => {
    await put({ constructionDate: "2026-12-01" });

    expect(h.linkCalls).toHaveLength(1);
    expect(h.linkCalls[0]).toMatchObject({
      tNumber: "T00003420",
      constructionDate: "2026-12-01",
    });
  });

  it("そのときは保存前レコードに連携用の列を足す", async () => {
    await put({ constructionDate: "2026-12-01" });

    const csv = h.fetchedCsv.filter(Boolean).join(",");
    expect(csv).toContain("field-9");
  });

  it("true 以外の値では連携しない", async () => {
    process.env.CUSTOMER_INFO_CONSTRUCTION_LINK_ON_SAVE = "1";

    await put({ constructionDate: "2026-12-01" });

    expect(h.linkCalls).toHaveLength(0);
  });
});
