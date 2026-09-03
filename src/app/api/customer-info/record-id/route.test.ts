import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T番号 → お客様情報レコードID の変換 API。
 *
 * 工事カレンダーの案件カードから契約情報入力フォームへ飛ぶために使う。
 * ここで固定するのは3点。
 *   1. 照合は findCustomerInfoRecordIdByUniqueKeyCached に任せる
 *      （このルートで @pocket のクエリを組み立てない）
 *   2. 応答は固定文言だけ。@pocket の内部構造を外へ出さない
 *   3. 空 400 / 見つからない 404 / 見つかった 200
 */

const h = vi.hoisted(() => ({
  lookupCalls: [] as Array<{ keyFieldId: string; uniqueKey: string }>,
  found: "rec-123" as string | null,
  lookupThrows: false,
  keyFieldResolves: true,
  importKeyEnv: "T番号",
  fieldsCalls: 0,
  rateLimitAllows: true,
  rateLimitKeys: [] as string[],
}));

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
  customerInfoImportKeyFieldId: () => h.importKeyEnv,
  customerInfoPocketAuth1: () => ({ apiKey: "dummy" }),
}));

vi.mock("@/lib/atpocket", () => ({
  fetchAppFields: async () => {
    h.fieldsCalls++;
    return [{ uniqueId: "field-1", caption: "T番号" }];
  },
}));

vi.mock("@/lib/calendar-kojo", () => ({
  resolveConfiguredFieldToSchemaUniqueId: () =>
    h.keyFieldResolves ? "field-1" : null,
}));

vi.mock("@/lib/simple-rate-limit", () => ({
  consumeRateLimit: (key: string) => {
    h.rateLimitKeys.push(key);
    return h.rateLimitAllows;
  },
}));

vi.mock("@/lib/customer-info-key-lookup-cache", () => ({
  findCustomerInfoRecordIdByUniqueKeyCached: async (
    keyFieldId: string,
    uniqueKey: string,
  ) => {
    h.lookupCalls.push({ keyFieldId, uniqueKey });
    if (h.lookupThrows) {
      throw new Error(
        'appsId=35 operation=customer-info:キー項目照合 key=CUSTOMER_INFO_ATPOCKET_API_KEY_1 "T00003420"',
      );
    }
    return h.found;
  },
}));

const { GET } = await import("@/app/api/customer-info/record-id/route");

const URL_BASE = "https://example.test/api/customer-info/record-id";

function get(query: string) {
  return GET(
    new Request(`${URL_BASE}${query}`, {
      headers: { Authorization: "Bearer dummy" },
    }),
  );
}

beforeEach(() => {
  h.lookupCalls = [];
  h.found = "rec-123";
  h.lookupThrows = false;
  h.keyFieldResolves = true;
  h.importKeyEnv = "T番号";
  h.fieldsCalls = 0;
  h.rateLimitAllows = true;
  h.rateLimitKeys = [];
  // 本番と同じ扱いにする（開発中だけ生メッセージが detail に付く仕様のため）
  process.env.API_ERROR_DETAIL = "0";
});

describe("見つかったとき", () => {
  it("recordId を返す", async () => {
    const res = await get("?tNumber=T00003420");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ recordId: "rec-123" });
  });

  it("★ 照合は共通の関数に渡す（ここでクエリを組み立てない）", async () => {
    await get("?tNumber=T00003420");

    expect(h.lookupCalls).toEqual([
      { keyFieldId: "field-1", uniqueKey: "T00003420" },
    ]);
  });

  it("前後の空白は落として渡す", async () => {
    await get(`?tNumber=${encodeURIComponent("  T00003420  ")}`);

    expect(h.lookupCalls[0]?.uniqueKey).toBe("T00003420");
  });
});

describe("見つからないとき", () => {
  it("404 と固定文言", async () => {
    h.found = null;
    const res = await get("?tNumber=T99999999");

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "該当するお客様情報が見つかりません",
    });
  });
});

describe("T番号が空のとき", () => {
  it("★ 400 で、照合そのものを行わない", async () => {
    const res = await get("");

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "T番号を指定してください",
    });
    expect(h.lookupCalls).toHaveLength(0);
    expect(h.fieldsCalls).toBe(0);
  });

  it("空白だけでも 400", async () => {
    const res = await get(`?tNumber=${encodeURIComponent("   ")}`);

    expect(res.status).toBe(400);
    expect(h.lookupCalls).toHaveLength(0);
  });

  it("桁外れに長い値は照合へ回さない", async () => {
    const res = await get(`?tNumber=${"T".repeat(65)}`);

    expect(res.status).toBe(400);
    expect(h.lookupCalls).toHaveLength(0);
  });
});

describe("連続操作", () => {
  it("上限に達したら 429 で、照合を行わない", () => {
    h.rateLimitAllows = false;

    return get("?tNumber=T00003420").then(async (res) => {
      expect(res.status).toBe(429);
      expect(h.lookupCalls).toHaveLength(0);
      expect(h.fieldsCalls).toBe(0);
    });
  });

  it("利用者ごとに数える", async () => {
    await get("?tNumber=T00003420");

    expect(h.rateLimitKeys).toEqual(["customer-info-record-id:U-test"]);
  });

  it("★ T番号が空のときは枠を消費しない", async () => {
    await get("");

    expect(h.rateLimitKeys).toHaveLength(0);
  });
});

describe("★ 応答に @pocket の情報を出さない", () => {
  it("例外は固定文言＋相関IDだけ（appsId・環境変数名・値を出さない）", async () => {
    h.lookupThrows = true;
    const res = await get("?tNumber=T00003420");
    const body = (await res.json()) as Record<string, unknown>;
    const text = JSON.stringify(body);

    expect(res.status).toBe(502);
    expect(body.error).toBe("お客様情報を確認できませんでした");
    expect(text).not.toContain("appsId");
    expect(text).not.toContain("ATPOCKET");
    expect(text).not.toContain("T00003420");
    expect(body.correlationId).toBeTruthy();
  });

  it("列を解決できないときも理由を書き分けない（503・固定文言）", async () => {
    h.keyFieldResolves = false;
    const res = await get("?tNumber=T00003420");
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(503);
    expect(body.error).toBe(
      "お客様情報との連携が設定されていません。管理者にお問い合わせください。",
    );
    expect(JSON.stringify(body)).not.toContain(
      "CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID",
    );
    expect(h.lookupCalls).toHaveLength(0);
  });

  it("取込キーが未設定なら 503（照合しない）", async () => {
    h.importKeyEnv = "";
    const res = await get("?tNumber=T00003420");

    expect(res.status).toBe(503);
    expect(h.lookupCalls).toHaveLength(0);
    expect(h.fieldsCalls).toBe(0);
  });
});
