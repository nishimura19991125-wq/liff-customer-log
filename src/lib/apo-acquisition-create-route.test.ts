import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * タスクT の退行確認: 登録の受け口。
 *
 * 添付を Dropbox へ移したので、登録本文にファイルは載らない。
 *   - 添付なしで登録できること
 *   - 添付を送るための recordId が応答に入ること
 *   - 監査ログにファイル本体（base64）が載らないこと
 *   - 昔の形（files 付き JSON）が来ても、本文をレコードに書かないこと
 */

const h = vi.hoisted(() => ({
  auth: { ok: true as boolean, lineUserId: "U1" },
  boundStaffName: "西村 直也" as string | null,
  createCalls: [] as Record<string, unknown>[],
  auditCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/request-auth", () => ({
  resolveCallerLineAuth: async () =>
    h.auth.ok
      ? { ok: true, lineUserId: h.auth.lineUserId }
      : { ok: false, reason: "invalid" },
  lineAuthUnauthorizedResponse: () =>
    new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
}));

vi.mock("@/lib/staff-bound-lookup", () => ({
  resolveBoundStaffNameForLineUser: async () => h.boundStaffName,
}));

vi.mock("@/lib/apo-acquisition-server", () => ({
  createApoAcquisitionRecord: async (
    _bound: string,
    payload: Record<string, unknown>,
  ) => {
    h.createCalls.push(payload);
    return {
      ok: true,
      recordId: "rec-1",
      apoNumber: "A00001603",
      audit: {
        appId: "app-apo",
        // 添付列は書かない。ここに base64 が入る余地は無い
        record: { "field-4": "山田 太郎" },
        labels: { "field-4": "お客様名" },
      },
    };
  },
}));

vi.mock("@/lib/audit-log", () => ({
  recordAuditLog: async (entry: Record<string, unknown>) => {
    h.auditCalls.push(entry);
  },
}));

const { POST } = await import("@/app/api/apo-acquisition/records/route");

function post(body: unknown) {
  return POST(
    new Request("https://example.test/api/apo-acquisition/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const VALUES = { customerName: "山田 太郎", apoAcquiredDate: "2026-08-26" };

beforeEach(() => {
  h.auth = { ok: true, lineUserId: "U1" };
  h.boundStaffName = "西村 直也";
  h.createCalls = [];
  h.auditCalls = [];
});

describe("★ 添付なしで登録できる", () => {
  it("200 と recordId を返す（添付の送信先になる）", async () => {
    const res = await post({ apStaffName: "西村 直也", values: VALUES });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, recordId: "rec-1" });
  });

  it("監査ログは create として残る", async () => {
    await post({ apStaffName: "西村 直也", values: VALUES });

    expect(h.auditCalls).toHaveLength(1);
    expect(h.auditCalls[0]).toMatchObject({
      operation: "create",
      targetRecordId: "rec-1",
    });
  });
});

describe("★ 本文にファイルを載せない", () => {
  it("登録の入力に files を渡さない", async () => {
    await post({ apStaffName: "西村 直也", values: VALUES });

    expect(h.createCalls).toHaveLength(1);
    expect(h.createCalls[0]).not.toHaveProperty("files");
  });

  it("昔の形（base64 同梱）が来ても素通りさせない", async () => {
    await post({
      apStaffName: "西村 直也",
      values: VALUES,
      files: {
        elevationPlanAttachment: [
          {
            name: "a.pdf",
            mimeType: "application/pdf",
            contentBase64: "JVBERi0xLjQK".repeat(50),
          },
        ],
      },
    });

    // 受け口で捨てる。@pocket にも監査ログにも本体は渡らない
    expect(h.createCalls[0]).not.toHaveProperty("files");
    expect(JSON.stringify(h.auditCalls)).not.toContain("JVBERi0xLjQK");
  });
});

describe("認証と紐付け", () => {
  it("未認証は 401", async () => {
    h.auth = { ok: false, lineUserId: "" };
    const res = await post({ values: VALUES });

    expect(res.status).toBe(401);
    expect(h.createCalls).toHaveLength(0);
  });

  it("スタッフ未紐付けは 403", async () => {
    h.boundStaffName = null;
    const res = await post({ values: VALUES });

    expect(res.status).toBe(403);
    expect(h.createCalls).toHaveLength(0);
  });
});
