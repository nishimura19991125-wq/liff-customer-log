import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 保存後にキャッシュを捨てているかを見る（修正6）。
 *
 * 以前は legacy 分岐にしか無く、フォームスキーマ分岐（通常の保存）では
 * 呼ばれていなかった。未入力一覧と T番号キー検索が古いまま残り、
 * 保存した案件が未入力に居座る・連携が既存レコードを見つけられない、
 * という形で表に出る。
 */

const h = vi.hoisted(() => ({
  pendingInvalidated: 0,
  keyLookupInvalidated: 0,
  updateCalls: [] as Array<Record<string, unknown>>,
}));

const APP_FIELDS = [
  { uniqueId: "field-2", caption: "お客様名" },
  { uniqueId: "field-3", caption: "AP担当者" },
  { uniqueId: "field-4", caption: "CL担当者" },
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
}));

vi.mock("@/lib/atpocket", () => ({
  fetchAppFields: async () => APP_FIELDS,
  fetchRecordById: async () => ({ record: {} }),
  updateRecord: async (
    _appId: string,
    _recordId: string,
    payload: Record<string, unknown>,
  ) => {
    h.updateCalls.push(payload);
  },
}));

vi.mock("@/lib/audit-log", () => ({
  auditLogEnabled: () => false,
  recordAuditLog: async () => ({ ok: true, written: 0 }),
}));

vi.mock("@/lib/dropbox", () => ({
  dropboxConfigured: () => false,
}));

vi.mock("@/lib/customer-info-dropbox-link", () => ({
  applyDropboxFolderRenameToPayload: async () => undefined,
  resolveCustomerInfoDropboxLinkFieldId: () => null,
}));

vi.mock("@/lib/customer-info-pending-cache", () => ({
  invalidateCustomerInfoPendingCache: () => {
    h.pendingInvalidated++;
  },
}));

vi.mock("@/lib/customer-info-key-lookup-cache", () => ({
  invalidateCustomerInfoKeyLookupCache: () => {
    h.keyLookupInvalidated++;
  },
}));

vi.mock("@/lib/staff-workplace-lookup", () => ({
  resolveStaffWorkplaceLookupConfig: async () => null,
  lookupStaffWorkplaceByStaffName: async () => null,
}));

vi.mock("@/lib/product-catalog-models", () => ({
  lookupBatteryModelNumberByCapacity: async () => null,
}));

// 必須チェックはこのテストの関心事ではない（別テストで担保）
vi.mock("@/lib/customer-info-form/validate", () => ({
  findMissingRequiredCustomerInfoFields: () => [],
  formatCustomerInfoRequiredValidationError: () => "required",
}));

const { PUT } = await import(
  "@/app/api/customer-info/records/[recordId]/route"
);

function putRequest(formValues: Record<string, unknown>): Request {
  return new Request("https://example.test/records/1483", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ formValues }),
  });
}

const ctx = { params: Promise.resolve({ recordId: "1483" }) };

beforeEach(() => {
  h.pendingInvalidated = 0;
  h.keyLookupInvalidated = 0;
  h.updateCalls = [];
});

describe("修正6: フォームスキーマ分岐でもキャッシュを無効化する", () => {
  it("★ 保存に成功したら未入力一覧とキー検索のキャッシュを捨てる", async () => {
    const res = await PUT(putRequest({ customerName: "山田太郎" }), ctx);

    expect(res.status).toBe(200);
    expect(h.updateCalls).toHaveLength(1);
    expect(h.pendingInvalidated).toBe(1);
    expect(h.keyLookupInvalidated).toBe(1);
  });

  it("更新する項目が無いときは保存もキャッシュ破棄もしない", async () => {
    const res = await PUT(putRequest({ unknownKey: "x" }), ctx);

    expect(res.status).toBe(400);
    expect(h.updateCalls).toHaveLength(0);
    expect(h.pendingInvalidated).toBe(0);
    expect(h.keyLookupInvalidated).toBe(0);
  });
});
