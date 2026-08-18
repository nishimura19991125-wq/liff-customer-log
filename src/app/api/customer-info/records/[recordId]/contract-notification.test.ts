import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * タスクR: 保存と契約速報の関係を PUT 越しに見る。
 *
 * 通知は「保存が成功したあと」に走り、通知がどうなろうと保存の応答は
 * ok:true のまま。失敗したときだけ warning が増える。
 */

const h = vi.hoisted(() => ({
  updateCalls: [] as Array<Record<string, unknown>>,
  /** 保存前レコードの入力ステータス */
  beforeInputStatus: "未入力",
  configured: true,
  sendResult: { kind: "sent" } as
    | { kind: "sent" }
    | { kind: "failed"; reason: string; status?: number },
  sentTexts: [] as string[],
  /** updateRecord と送信の実行順 */
  order: [] as string[],
}));

const APP_FIELDS = [
  { uniqueId: "field-1", caption: "T番号" },
  { uniqueId: "field-2", caption: "お客様名" },
  { uniqueId: "field-3", caption: "AP担当者" },
  { uniqueId: "field-4", caption: "CL担当者" },
  { uniqueId: "field-5", caption: "入力ステータス" },
  { uniqueId: "field-77", caption: "蓄電池設置箇所" },
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
  fetchRecordById: async () => ({
    record: {
      "field-1": "T-1483",
      "field-5": h.beforeInputStatus,
      "field-77": "屋内",
    },
  }),
  updateRecord: async (
    _appId: string,
    _recordId: string,
    payload: Record<string, unknown>,
  ) => {
    h.updateCalls.push(payload);
    h.order.push("update");
  },
}));

vi.mock("@/lib/google-chat", () => ({
  googleChatContractWebhookConfigured: () => h.configured,
  sendGoogleChatContractMessage: async (text: string) => {
    h.sentTexts.push(text);
    h.order.push("send");
    return h.sendResult;
  },
}));

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
}));

vi.mock("@/lib/product-catalog-models", () => ({
  lookupBatteryModelNumberByCapacity: async () => null,
}));

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

async function put(formValues: Record<string, unknown>) {
  const res = await PUT(putRequest(formValues), ctx);
  return {
    status: res.status,
    body: (await res.json()) as { ok?: boolean; warning?: string },
  };
}

beforeEach(() => {
  h.updateCalls = [];
  h.beforeInputStatus = "未入力";
  h.configured = true;
  h.sendResult = { kind: "sent" };
  h.sentTexts = [];
  h.order = [];
});

describe("タスクR: 保存と契約速報", () => {
  it("★「未入力」→「入力完了」で保存すると通知が飛ぶ", async () => {
    const { status, body } = await put({ inputStatus: "入力完了" });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(h.updateCalls).toHaveLength(1);
    expect(h.sentTexts).toHaveLength(1);
    // フォームに無い列（T番号・蓄電池設置箇所）が保存前レコードから入る
    expect(h.sentTexts[0]).toContain("T番号：T-1483");
    expect(h.sentTexts[0]).toContain("蓄電池：全負荷、屋内");
  });

  it("★ 既に「入力完了」の案件を再保存しても飛ばない", async () => {
    h.beforeInputStatus = "入力完了";

    const { status, body } = await put({ inputStatus: "入力完了" });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(h.updateCalls).toHaveLength(1);
    expect(h.sentTexts).toHaveLength(0);
  });

  it("★ 環境変数が未設定でも保存は成功し、警告も出さない", async () => {
    h.configured = false;

    const { status, body } = await put({ inputStatus: "入力完了" });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(h.updateCalls).toHaveLength(1);
    expect(h.sentTexts).toHaveLength(0);
  });

  it("★ 送信に失敗しても保存は成功し、warning を返す", async () => {
    h.sendResult = { kind: "failed", reason: "http", status: 503 };
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { status, body } = await put({ inputStatus: "入力完了" });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.warning).toBe(
      "契約速報の送信に失敗しました。DX事業部へ連絡してください。",
    );
    expect(h.updateCalls).toHaveLength(1);
  });

  it("★ 通知は @pocket への保存が済んでから送る", async () => {
    const { status } = await put({ inputStatus: "入力完了" });

    expect(status).toBe(200);
    expect(h.order).toEqual(["update", "send"]);
  });

  it("入力ステータスを触らない保存では飛ばない", async () => {
    const { status, body } = await put({ customerName: "山田太郎" });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(h.updateCalls).toHaveLength(1);
    expect(h.sentTexts).toHaveLength(0);
  });
});
