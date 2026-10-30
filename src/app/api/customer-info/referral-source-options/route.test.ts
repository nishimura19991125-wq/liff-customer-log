import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 紹介元の選択肢（トラーチ倶楽部加盟店）を返す API。
 * 応答の形は信販会社・施工業者の API と同じ { options, configured }。
 */

const h = vi.hoisted(() => ({
  result: [] as string[] | null,
  throws: false,
}));

vi.mock("@/lib/request-auth", () => ({
  resolveCallerLineAuth: async () => ({ ok: true, lineUserId: "U-test" }),
  lineAuthUnauthorizedResponse: () => new Response(null, { status: 401 }),
}));

vi.mock("@/lib/trading-partner-manufacturers", () => ({
  fetchTradingPartnerClubMemberOptions: async () => {
    if (h.throws) throw new Error("boom");
    return h.result;
  },
}));

const { GET } = await import("@/app/api/customer-info/referral-source-options/route");

async function get() {
  const res = await GET(new Request("https://example.test/x"));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  h.result = [];
  h.throws = false;
});

describe("紹介元の選択肢 API", () => {
  it("一覧を返す", async () => {
    h.result = ["アオイ工業", "カトウ商店"];
    expect(await get()).toEqual({
      status: 200,
      body: { options: ["アオイ工業", "カトウ商店"], configured: true },
    });
  });

  it("未設定なら configured: false", async () => {
    h.result = null;
    expect(await get()).toEqual({
      status: 200,
      body: { options: [], configured: false },
    });
  });

  it("失敗したら 502。内部の事情は出さない", async () => {
    h.throws = true;
    const res = await get();
    expect(res.status).toBe(502);
    expect(res.body.options).toEqual([]);
    expect(String(res.body.error)).not.toMatch(/field-|11|TRADING/);
  });
});
