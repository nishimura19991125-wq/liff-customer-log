import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 工事日の変更を止めたとき（CALENDAR_CONSTRUCTION_MOVE_ENABLED が false / 未設定）、
 *
 *   - 止める3本は、処理に入る前に 403 を返す
 *     （本文を読まない・@pocket へ1回も問い合わせない）
 *   - 拒否の文言に内部の事情（変数名など）を出さない
 *   - 残す5本は今までどおり処理に入る
 *
 * を固定する。「処理に入ったか」は request.json() が呼ばれたかで見る。
 * どのルートも本文を読んでから @pocket に問い合わせるので、本文を
 * 読まなければ書き込みも起きない。念のため fetch も見張る。
 */

const auth = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/lib/request-auth", () => ({
  resolveCallerLineAuth: async () => {
    auth.calls += 1;
    return { ok: true, lineUserId: "U-test" };
  },
  lineAuthUnauthorizedResponse: () => new Response(null, { status: 401 }),
}));

vi.mock("@/lib/customer-info-config", async (importOriginal) => {
  const orig =
    await importOriginal<typeof import("@/lib/customer-info-config")>();
  return { ...orig, customerInfoConfigReady: () => ({ ok: true }) };
});

const { POST: moveConstructionCase } = await import(
  "@/app/api/calendar/move-construction-case/route"
);
const { POST: assignCaseToSlot } = await import(
  "@/app/api/calendar/assign-case-to-slot/route"
);
const { POST: scheduleUndatedCase } = await import(
  "@/app/api/calendar/schedule-undated-case/route"
);
const { POST: createRecord } = await import(
  "@/app/api/calendar/create-record/route"
);
const { POST: fillEmptySlot } = await import(
  "@/app/api/calendar/fill-empty-slot/route"
);
const { POST: assignCustomerCase } = await import(
  "@/app/api/calendar/assign-customer-case/route"
);
const { POST: updateConstructionHandler } = await import(
  "@/app/api/calendar/update-construction-handler/route"
);
const { PUT: putCustomerInfoRecord } = await import(
  "@/app/api/customer-info/records/[recordId]/route"
);

const ENV_KEYS = [
  "CALENDAR_CONSTRUCTION_MOVE_ENABLED",
  "CALENDAR_APP_ID",
  "CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID",
] as const;
const savedEnv: Record<string, string | undefined> = {};

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  delete process.env.CALENDAR_CONSTRUCTION_MOVE_ENABLED;
  // 止めていなければ先へ進めるだけの設定は入れておく
  process.env.CALENDAR_APP_ID = "cal-1";
  process.env.CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID = "field-2";
  auth.calls = 0;
  fetchSpy = vi.fn(async () => {
    throw new Error("テストでは @pocket に問い合わせない");
  });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.unstubAllGlobals();
});

/** 本文が読まれたかを数えられるリクエスト。本文はわざと壊してある */
function trackedRequest(url: string, method = "POST") {
  const req = new Request(url, {
    method,
    headers: {
      Authorization: "Bearer t",
      "Content-Type": "application/json",
    },
    body: "{not json",
  });
  const jsonSpy = vi.spyOn(req, "json");
  return { req, jsonSpy };
}

type Handler = (req: Request) => Promise<Response>;

const BLOCKED: Array<[string, Handler]> = [
  ["move-construction-case", (r) => moveConstructionCase(r)],
  ["assign-case-to-slot", (r) => assignCaseToSlot(r)],
  ["schedule-undated-case", (r) => scheduleUndatedCase(r)],
];

const KEPT: Array<[string, Handler]> = [
  ["create-record", (r) => createRecord(r)],
  ["fill-empty-slot", (r) => fillEmptySlot(r)],
  ["assign-customer-case", (r) => assignCustomerCase(r)],
  ["update-construction-handler", (r) => updateConstructionHandler(r)],
  [
    "customer-info/records/[recordId] PUT",
    (r) =>
      putCustomerInfoRecord(r, {
        params: Promise.resolve({ recordId: "rec-1" }),
      }),
  ],
];

describe("止める3本（既定＝変数なし）", () => {
  it.each(BLOCKED)("★ %s は 403 を返し、処理に入らない", async (name, run) => {
    const { req, jsonSpy } = trackedRequest(
      `http://localhost/api/calendar/${name}`,
    );
    const res = await run(req);

    expect(res.status).toBe(403);
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(BLOCKED)("★ %s の拒否文言に内部の事情を出さない", async (name, run) => {
    const { req } = trackedRequest(`http://localhost/api/calendar/${name}`);
    const res = await run(req);
    const body = (await res.json()) as { error?: unknown };
    const text = JSON.stringify(body);

    expect(typeof body.error).toBe("string");
    expect(String(body.error).length).toBeGreaterThan(0);
    for (const leak of [
      "CALENDAR_",
      "ENABLED",
      "環境変数",
      "env",
      "false",
      "@pocket",
      name,
    ]) {
      expect(text, `拒否文言に「${leak}」が出ている`).not.toContain(leak);
    }
  });

  it.each(BLOCKED)("★ %s は \"false\" を入れたときも 403", async (name, run) => {
    process.env.CALENDAR_CONSTRUCTION_MOVE_ENABLED = "false";
    const { req, jsonSpy } = trackedRequest(
      `http://localhost/api/calendar/${name}`,
    );
    const res = await run(req);

    expect(res.status).toBe(403);
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it.each(BLOCKED)(
    "★ %s は true にすると元どおり処理に入る",
    async (name, run) => {
      process.env.CALENDAR_CONSTRUCTION_MOVE_ENABLED = "true";
      const { req, jsonSpy } = trackedRequest(
        `http://localhost/api/calendar/${name}`,
      );
      const res = await run(req);

      expect(res.status).not.toBe(403);
      // 壊れた本文を読んで 400 で返す＝入口の先まで進んでいる
      expect(jsonSpy).toHaveBeenCalled();
      expect(res.status).toBe(400);
    },
  );
});

describe("残す5本（既定＝変数なしでも動く）", () => {
  it.each(KEPT)("★ %s は止めない", async (name, run) => {
    const { req, jsonSpy } = trackedRequest(`http://localhost/api/${name}`);
    const res = await run(req);

    expect(res.status).not.toBe(403);
    expect(jsonSpy).toHaveBeenCalled();
    expect(res.status).toBe(400);
  });
});
