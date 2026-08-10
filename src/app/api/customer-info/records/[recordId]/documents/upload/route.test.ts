import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * アップロード対象外の項目キーがサーバで拒否されることを確認する。
 *
 * 画面側の出し分けだけに頼らないための防御なので、ヘルパ単体ではなく
 * ルートの応答（400 と文言）まで見る。
 *
 * @pocket / Dropbox へは到達しない位置で弾かれるため、
 * 認証と設定確認だけを差し替えれば足りる。
 */

vi.mock("@/lib/request-auth", () => ({
  resolveCallerLineAuth: async () => ({ ok: true, lineUserId: "U-test" }),
  lineAuthUnauthorizedResponse: () =>
    new Response(null, { status: 401 }),
}));

vi.mock("@/lib/customer-info-config", () => ({
  customerInfoConfigReady: () => ({
    ok: true,
    appId: "35",
    nameFieldId: "field-1",
  }),
  customerInfoPocketAuth1: () => ({ apiKey: "dummy" }),
  customerInfoPocketAuthWrite: () => ({ apiKey: "dummy" }),
  customerInfoImportKeyFieldId: () => "field-135",
  customerInfoImportKeySourceFieldIds: () => [],
}));

vi.mock("@/lib/dropbox", () => ({
  dropboxConfigured: () => true,
  dropboxCustomerFolderPath: () => "/root/folder",
}));

const { POST } = await import(
  "@/app/api/customer-info/records/[recordId]/documents/upload/route"
);

function uploadRequest(documentKey: string): Request {
  const form = new FormData();
  form.set("documentKey", documentKey);
  form.set(
    "file",
    new File([new Uint8Array([1, 2, 3])], "test.pdf", {
      type: "application/pdf",
    }),
  );
  return new Request("https://example.test/upload", {
    method: "POST",
    body: form,
  });
}

const ctx = { params: Promise.resolve({ recordId: "123" }) };

describe("アップロード対象外の項目は 400 で拒否する", () => {
  beforeEach(async () => {
    // レート制限はプロセスメモリなのでテスト間で持ち越さない
    const { resetRateLimitStore } = await import("@/lib/simple-rate-limit");
    resetRateLimitStore();
  });

  it.each([
    ["loanPaper", "ローン用紙"],
    ["groupCreditLifeInsurance", "団体信用生命保険"],
    ["salesConstructionContract", "商品売買・工事請負契約書"],
    ["powerCompanyForm", "電力会社記入用紙"],
    ["feedInBankAccountForm", "売電先振込口座指定依頼書"],
    ["equipmentCertConsent", "設備認定に関する同意書"],
    ["operatingCostReportConsent", "運転費用年報提出に関する同意書"],
    ["personalInfoConsent", "個人情報の取扱に関する同意書"],
    ["freeUseGenerationConsent", "発電設備の無償使用に関する同意書"],
    ["subsidyPreApplicationDocs", "補助金事前申請書類"],
  ])("%s は対象外", async (key, caption) => {
    const res = await POST(uploadRequest(key), ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain(caption);
    expect(body.error).toContain("対象外");
  });

  it("書類項目ですらないキーも拒否する", async () => {
    const res = await POST(uploadRequest("customerName"), ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("書類の項目が不正です");
  });

  it("空のキーも拒否する", async () => {
    const res = await POST(uploadRequest(""), ctx);
    expect(res.status).toBe(400);
  });
});

describe("アップロード対象の6項目は項目チェックを通過する", () => {
  beforeEach(async () => {
    const { resetRateLimitStore } = await import("@/lib/simple-rate-limit");
    resetRateLimitStore();
    // 項目チェックを通ると @pocket へ進んで接続に失敗する。
    // 想定内なのでログを抑えてテスト出力を読みやすく保つ
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    "powerOfAttorneyStorage",
    "powerOfAttorneyChangeCert",
    "powerOfAttorneyIdPassword",
    "vicinitySketchMap",
    "sealRegistrationCertificate",
    "registryBook",
  ])("%s は「対象外」で弾かれない", async (key) => {
    const res = await POST(uploadRequest(key), ctx);
    // この先は @pocket への接続で失敗するが、
    // 「対象外」による 400 ではないことを確認できればよい
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    expect(body.error ?? "").not.toContain("対象外");
  });
});
