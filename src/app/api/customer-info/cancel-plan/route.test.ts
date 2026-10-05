import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * キャンセル確認画面に出す「実行される内容」を返す API。
 *
 * 返すのは「工事登録アプリのレコードを削除するか」だけ。削除は環境変数で
 * 止められるので、止めている間は確認画面の文言も実態に合わせる必要がある。
 * 環境変数はサーバでしか読めないため、画面はこの応答だけを見る。
 */

const h = vi.hoisted(() => ({ authorized: true }));

vi.mock("@/lib/request-auth", () => ({
  resolveCallerLineAuth: async () =>
    h.authorized ? { ok: true, lineUserId: "U-test" } : { ok: false },
  lineAuthUnauthorizedResponse: () =>
    Response.json({ error: "unauthorized" }, { status: 401 }),
}));

const { GET } = await import("@/app/api/customer-info/cancel-plan/route");

const KEY = "CUSTOMER_CANCEL_DELETE_CONSTRUCTION_RECORD";
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[KEY];
  delete process.env[KEY];
  h.authorized = true;
});

afterEach(() => {
  if (saved === undefined) delete process.env[KEY];
  else process.env[KEY] = saved;
});

async function call() {
  const res = await GET(
    new Request("https://example.test/api/customer-info/cancel-plan"),
  );
  return {
    status: res.status,
    body: (await res.json()) as {
      ok?: boolean;
      plan?: Record<string, unknown>;
    },
  };
}

describe("★ 削除の可否を返す", () => {
  it("★ 既定（未設定）では deletesConstructionRecord が true", async () => {
    const { status, body } = await call();

    expect(status).toBe(200);
    expect(body).toEqual({
      ok: true,
      plan: { deletesConstructionRecord: true },
    });
  });

  it("★ 環境変数で止めているときは false", async () => {
    process.env[KEY] = "false";
    expect((await call()).body.plan).toEqual({
      deletesConstructionRecord: false,
    });

    process.env[KEY] = "0";
    expect((await call()).body.plan).toEqual({
      deletesConstructionRecord: false,
    });
  });

  it("★ 空き枠の判定は返さない（自動作成は廃止）", async () => {
    const { body } = await call();

    expect(Object.keys(body.plan ?? {})).toEqual(["deletesConstructionRecord"]);
  });

  it("認証できなければ 401", async () => {
    h.authorized = false;

    expect((await call()).status).toBe(401);
  });
});
