import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 調査用ルートの安全策。
 *
 * 本番に置くものなので、閉じていること・秘密を返さないこと・既定で
 * 送らないことを固定する。中身の判定は本番と同じ関数を通すので、
 * ここでは「入口」だけを見る。
 */

const h = vi.hoisted(() => ({
  configured: true,
  boundName: "西村" as string | null,
  notifyCalls: [] as Record<string, unknown>[],
  authOk: true,
}));

vi.mock("@/lib/google-chat", () => ({
  googleChatNewCaseWebhookConfigured: () => h.configured,
}));

vi.mock("@/lib/staff-bound-lookup", () => ({
  resolveBoundStaffNameForLineUser: async () => h.boundName,
}));

vi.mock("@/lib/new-case-notification-server", () => ({
  notifyNewCaseCreated: async (o: Record<string, unknown>) => {
    h.notifyCalls.push(o);
    return { kind: "sent" };
  },
}));

vi.mock("@/lib/request-auth", () => ({
  resolveCallerLineAuth: async () =>
    h.authOk
      ? { ok: true, lineUserId: "U-line-1" }
      : { ok: false, reason: "unauthorized" },
  lineAuthUnauthorizedResponse: () =>
    new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
}));

const { POST } = await import("@/app/api/%5Fprobe/new-case-notify/route");

function post(body?: Record<string, unknown>) {
  return POST(
    new Request("https://example.test/api/_probe/new-case-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}

beforeEach(() => {
  process.env.NEW_CASE_NOTIFY_PROBE_ENABLED = "1";
  h.configured = true;
  h.boundName = "西村";
  h.notifyCalls = [];
  h.authOk = true;
});

describe("調査用ルートの入口", () => {
  it("★ 有効化していなければ 404（存在しないルートと同じ見え方）", async () => {
    delete process.env.NEW_CASE_NOTIFY_PROBE_ENABLED;

    const res = await post();

    expect(res.status).toBe(404);
  });

  it("★ 無効なら認証より前に 404 を返す（認証の有無を漏らさない）", async () => {
    delete process.env.NEW_CASE_NOTIFY_PROBE_ENABLED;
    h.authOk = false;

    const res = await post();

    expect(res.status).toBe(404);
  });

  it("LINE 認証が無ければ 401", async () => {
    h.authOk = false;

    const res = await post();

    expect(res.status).toBe(401);
  });

  it("名簿に紐付いていなければ 403", async () => {
    h.boundName = null;

    const res = await post();

    expect(res.status).toBe(403);
  });

  it("★ 既定では送らない（本文と設定の有無だけ返す）", async () => {
    const res = await post({});
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.dryRun).toBe(true);
    expect(body.webhookConfigured).toBe(true);
    expect(body.text).toContain("🐣新規案件が追加されました🐣");
    expect(h.notifyCalls).toEqual([]);
  });

  it("引数なしでも動く（設定の確認だけなら本文は要らない）", async () => {
    const res = await post();

    expect(res.status).toBe(200);
    expect(h.notifyCalls).toEqual([]);
  });

  it("★ 環境変数が見えているかを true/false で返す", async () => {
    h.configured = false;

    const res = await post({});
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.webhookConfigured).toBe(false);
  });

  it("★ send:true のときだけ本番と同じ関数を通す", async () => {
    const res = await post({ send: true, tNumber: "T00003420" });
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.dryRun).toBe(false);
    expect(body.outcome).toEqual({ kind: "sent" });
    expect(h.notifyCalls).toEqual([
      {
        tNumber: "T00003420",
        customerName: "（通知テスト）",
        lineUserId: "U-line-1",
      },
    ]);
  });

  it("★ 応答に Webhook URL を含めない", async () => {
    process.env.GOOGLE_CHAT_NEW_CASE_WEBHOOK_URL =
      "https://chat.googleapis.com/v1/spaces/AAA?key=SECRET";

    const res = await post({ send: true });
    const raw = await res.text();

    expect(raw).not.toContain("SECRET");
    expect(raw).not.toContain("chat.googleapis.com");

    delete process.env.GOOGLE_CHAT_NEW_CASE_WEBHOOK_URL;
  });
});
