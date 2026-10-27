import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 登録画面に出す「登録済みの日」（休暇・段階5）。
 * 段階1の fetchLeaveMonth（年月ごとの全員共通キャッシュ）を通す。
 */

const h = vi.hoisted(() => ({
  bound: new Map<string, string>(),
  rowsByMonth: new Map<string, unknown[]>(),
  failMonths: new Set<string>(),
  queries: [] as string[],
}));

const LEAVE_FIELDS = [
  { uniqueId: "field-1", caption: "従業員名", fieldType: "Text" },
  { uniqueId: "field-2", caption: "休暇種別", fieldType: "Text" },
  { uniqueId: "field-3", caption: "kyukaID", fieldType: "AutoNumber", primaryKey: true },
  { uniqueId: "field-4", caption: "休暇予定日", fieldType: "Date" },
];

vi.mock("@/lib/atpocket", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/atpocket")>();
  return {
    ...actual,
    fetchAppFields: async () => LEAVE_FIELDS,
    fetchAllRecordsPages: async (
      _appId: string,
      _csv: string,
      _auth: unknown,
      query: string,
    ) => {
      h.queries.push(query);
      const ym = /"(\d{4}-\d{2})-01"/.exec(query)?.[1] ?? "";
      if (h.failMonths.has(ym)) throw new Error("@pocket 500");
      return h.rowsByMonth.get(ym) ?? [];
    },
    isPocketHttpRateLimitError: () => false,
  };
});

vi.mock("@/lib/staff-bound-lookup", () => ({
  resolveBoundStaffNameForLineUser: async (id: string) => h.bound.get(id) ?? null,
}));

vi.mock("@/lib/request-auth", () => ({
  resolveCallerLineAuth: async (req: Request) => {
    const id = req.headers.get("x-test-user");
    return id ? { ok: true, lineUserId: id } : { ok: false, status: 401 };
  },
  lineAuthUnauthorizedResponse: () =>
    new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
}));

const { getRegisteredLeavesForLineUser } = await import("@/lib/leave-registered-server");
const { GET } = await import("@/app/api/attendance/leave/registered/route");
const { invalidateLeaveCache } = await import("@/lib/leave-server");

const ME = "社員A";
const NOW = new Date("2026-10-27T05:00:00Z"); // JST 10/27(火) → 11/2〜11/15

function row(name: string, date: string) {
  return { recordId: 1, record: { "field-1": name, "field-2": "休み", "field-4": date } };
}

beforeEach(() => {
  process.env.LEAVE_APP_ID = "199";
  process.env.LEAVE_ATPOCKET_API_KEY = "leave-key";
  h.bound = new Map([["U-me", ME]]);
  h.rowsByMonth = new Map();
  h.failMonths = new Set();
  h.queries = [];
  invalidateLeaveCache();
});

describe("★ 表示する2週間と、本人の登録済みの日", () => {
  it("★ 期間は JST の来週月曜から2週間", async () => {
    const res = await getRegisteredLeavesForLineUser("U-me", NOW);
    expect(res.ok && res.window).toEqual({ start: "2026-11-02", end: "2026-11-15" });
  });

  it("★ 本人の、期間内の休みだけを返す（他人・期間外は入れない）", async () => {
    h.rowsByMonth.set("2026-11", [
      row(ME, "2026/11/03"),
      row("社員B", "2026/11/04"),
      row(ME, "2026/11/20"),
      row(` 社員Ａ　`, "2026/11/05"),
    ]);
    const res = await getRegisteredLeavesForLineUser("U-me", NOW);
    expect(res.ok && res.leavesStatus).toBe("ok");
    expect(res.ok && res.registered).toEqual(["2026-11-03", "2026-11-05"]);
  });

  it("★ 月をまたぐときは両方の月を読む", async () => {
    const now = new Date("2026-10-20T05:00:00Z"); // → 10/26〜11/8
    h.rowsByMonth.set("2026-10", [row(ME, "2026/10/27")]);
    h.rowsByMonth.set("2026-11", [row(ME, "2026/11/02")]);
    const res = await getRegisteredLeavesForLineUser("U-me", now);
    expect(res.ok && res.registered).toEqual(["2026-10-27", "2026-11-02"]);
    expect(h.queries).toHaveLength(2);
  });

  it("★ 何人が開いても、@pocket への問い合わせは月ごとに1回（キャッシュを共有）", async () => {
    h.bound = new Map([["U1", "社員1"], ["U2", "社員2"], ["U3", "社員3"]]);
    for (const id of h.bound.keys()) await getRegisteredLeavesForLineUser(id, NOW);
    expect(h.queries).toHaveLength(1);
  });

  it("★ 休暇アプリが読めなければ error で、registered は空の配列にしない", async () => {
    h.failMonths.add("2026-11");
    const res = await getRegisteredLeavesForLineUser("U-me", NOW);
    expect(res.ok && res.leavesStatus).toBe("error");
    expect(res.ok && res.registered).toBeNull();
  });

  it("★ 月をまたいで片方だけ失敗しても error", async () => {
    h.failMonths.add("2026-10");
    const res = await getRegisteredLeavesForLineUser("U-me", new Date("2026-10-20T05:00:00Z"));
    expect(res.ok && res.leavesStatus).toBe("error");
  });

  it("休暇アプリが未設定なら disabled", async () => {
    delete process.env.LEAVE_APP_ID;
    const res = await getRegisteredLeavesForLineUser("U-me", NOW);
    expect(res.ok && res.leavesStatus).toBe("disabled");
  });

  it("★ 紐付けが無ければ 403", async () => {
    const res = await getRegisteredLeavesForLineUser("U-none", NOW);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });
});

describe("★ API の応答", () => {
  it("★ 応答に氏名を載せない", async () => {
    h.rowsByMonth.set("2026-11", [row(ME, "2026/11/03"), row("社員B", "2026/11/04")]);
    const res = await GET(
      new Request("http://x/api/attendance/leave/registered", {
        headers: { "x-test-user": "U-me" },
      }),
    );
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(ME);
    expect(text).not.toContain("社員B");
    expect(JSON.parse(text).registered).toContain("2026-11-03");
  });

  it("LINE 認証が無ければ 401", async () => {
    const res = await GET(new Request("http://x/api/attendance/leave/registered"));
    expect(res.status).toBe(401);
  });
});
