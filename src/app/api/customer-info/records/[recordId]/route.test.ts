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
  /** updateRecord に投げさせるエラー。null なら成功 */
  updateError: null as Error | null,
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
    if (h.updateError) throw h.updateError;
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
  h.updateError = null;
  // 本番と同じ扱い（未設定だと NODE_ENV=test で生メッセージが添えられる）
  process.env.API_ERROR_DETAIL = "0";
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

/**
 * 保存が 400 で失敗したとき、原因の項目を画面に出す（ルート経由）。
 *
 * 値の形式が合わないと @pocket は 400 を返すが、これまでは
 * 「更新に失敗しました」しか出ず、利用者は何を直せばよいか分からなかった。
 */
describe("保存に失敗した項目を画面に出す", () => {
  /** 実物と同じ形。appsId・環境変数名まで載っていることがある */
  function pocket400(body: string): Error {
    return new Error(`@pocket update record failed: 400 ${body}`);
  }

  async function putAndReadError(error: Error): Promise<string> {
    h.updateError = error;
    const res = await PUT(putRequest({ customerName: "山田太郎" }), ctx);
    expect(res.status).toBe(502);
    const data = (await res.json()) as { error?: string };
    return data.error ?? "";
  }

  it("★ 応答本文の列の識別名を見出しへ引き直して出す", async () => {
    const message = await putAndReadError(
      pocket400('{"field":"field-3","message":"数値で入力してください"}'),
    );

    expect(message).toContain("次の項目の値をご確認ください");
    expect(message).toContain("AP担当者");
    expect(message).toMatch(/（ID: [0-9a-f]{8}）$/);
  });

  it("★ 複数見つかったら並べる", async () => {
    const message = await putAndReadError(
      pocket400("field-3 と field-4 が不正です"),
    );

    expect(message).toContain("AP担当者");
    expect(message).toContain("CL担当者");
  });

  it("★ 値・識別名・内部情報を画面へ出さない", async () => {
    const message = await putAndReadError(
      pocket400(
        '{"field":"field-3","value":"10000円"} | appsId=35 | apiKey=CUSTOMER_INFO_ATPOCKET_API_KEY_2',
      ),
    );

    for (const leak of [
      "10000円",
      "field-3",
      "appsId",
      "apiKey",
      "CUSTOMER_INFO_ATPOCKET_API_KEY_2",
      "@pocket",
    ]) {
      expect(message, leak).not.toContain(leak);
    }
  });

  it("★ 引き直せないときは従来の文言のまま", async () => {
    const message = await putAndReadError(pocket400("Bad Request"));

    expect(message).toContain("更新に失敗しました");
    expect(message).not.toContain("次の項目の値をご確認ください");
  });

  it("★ 知らない識別名だけのときも従来の文言のまま（推測で出さない）", async () => {
    const message = await putAndReadError(pocket400("field-999 が不正です"));

    expect(message).not.toContain("次の項目の値をご確認ください");
    expect(message).not.toContain("field-999");
  });

  it("既存の分岐（取込設定）は変えていない", async () => {
    const message = await putAndReadError(
      new Error("キー項目「T番号」が取込設定に存在しないため登録できません"),
    );

    expect(message).toContain("取込キー「T番号」");
    expect(message).not.toContain("次の項目の値をご確認ください");
  });
});
