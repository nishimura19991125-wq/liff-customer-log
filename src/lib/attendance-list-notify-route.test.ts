import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * タスクY: 定時実行の受け口の認証。
 *
 * 一致しないときも未設定のときも 404。トークンは応答にもログにも出さない。
 * 呼び出し元の cron サービスを選ばないこと（GET/POST・クエリ/本文）。
 */

const h = vi.hoisted(() => ({
  runCalls: [] as string[],
  outcome: {
    mode: "clock-in",
    sent: true,
    attendeeCount: 3,
    listedCount: 3,
  } as Record<string, unknown>,
  runThrows: false,
}));

vi.mock("@/lib/attendance-list-notification-server", () => ({
  runAttendanceListNotification: async (mode: string) => {
    h.runCalls.push(mode);
    if (h.runThrows) throw new Error("想定外 西村直也");
    return { ...h.outcome, mode };
  },
}));

const { GET, POST } = await import("@/app/api/attendance/list-notify/route");

const TOKEN = "s3cret-token-value";
const URL_BASE = "https://example.test/api/attendance/list-notify";

function get(path: string, token?: string) {
  return GET(
    new Request(`${URL_BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
  );
}

function post(body: unknown, token?: string, path = "") {
  return POST(
    new Request(`${URL_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  process.env.ATTENDANCE_SCHEDULE_TOKEN = TOKEN;
  h.runCalls = [];
  h.runThrows = false;
});

describe("★ トークンが一致しないときは 404", () => {
  it("トークンが無ければ 404", async () => {
    const res = await post({ mode: "clock-in" });

    expect(res.status).toBe(404);
    expect(h.runCalls).toHaveLength(0);
  });

  it("トークンが違えば 404", async () => {
    const res = await post({ mode: "clock-in" }, "wrong-token");

    expect(res.status).toBe(404);
    expect(h.runCalls).toHaveLength(0);
  });

  it("★ 長さだけ合っていても 404", async () => {
    const res = await post({ mode: "clock-in" }, "x".repeat(TOKEN.length));

    expect(res.status).toBe(404);
    expect(h.runCalls).toHaveLength(0);
  });

  it("★ 前方一致でも通らない", async () => {
    const res = await post({ mode: "clock-in" }, TOKEN.slice(0, -1));

    expect(res.status).toBe(404);
  });

  it("Bearer 以外の形式は通らない", async () => {
    const res = await POST(
      new Request(URL_BASE, {
        method: "POST",
        headers: { Authorization: TOKEN },
        body: JSON.stringify({ mode: "clock-in" }),
      }),
    );

    expect(res.status).toBe(404);
  });

  it("★ 401 ではなく 404（ルートの存在を明かさない）", async () => {
    const res = await post({ mode: "clock-in" }, "wrong-token");

    expect(res.status).not.toBe(401);
    expect(res.status).toBe(404);
  });
});

describe("★ トークンが未設定のときも 404", () => {
  it("未設定なら正しいトークンでも通らない", async () => {
    delete process.env.ATTENDANCE_SCHEDULE_TOKEN;

    const res = await post({ mode: "clock-in" }, TOKEN);

    expect(res.status).toBe(404);
    expect(h.runCalls).toHaveLength(0);
  });

  it("★ 空文字なら、ヘッダ無しでも通らない", async () => {
    process.env.ATTENDANCE_SCHEDULE_TOKEN = "   ";

    const res = await post({ mode: "clock-in" });

    expect(res.status).toBe(404);
    expect(h.runCalls).toHaveLength(0);
  });
});

describe("★ トークンを出力しない", () => {
  it("応答本文にトークンが出ない", async () => {
    const res = await post({ mode: "clock-in" }, TOKEN);
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).not.toContain(TOKEN);
  });

  it("404 の応答にもトークンが出ない", async () => {
    const res = await post({ mode: "clock-in" }, "wrong-token");
    const text = await res.text();

    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("wrong-token");
  });

  it("★ 例外時のログにもトークンや氏名を出さない", async () => {
    h.runThrows = true;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post({ mode: "clock-in" }, TOKEN);
    const text = await res.text();

    expect(res.status).toBe(500);
    const logged = errorSpy.mock.calls.flat().join(" ");
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain("西村直也");
    expect(text).not.toContain("西村直也");
  });
});

describe("★ cron サービスを選ばない", () => {
  it("POST + 本文で動く", async () => {
    const res = await post({ mode: "missing-clock-out" }, TOKEN);

    expect(res.status).toBe(200);
    expect(h.runCalls).toEqual(["missing-clock-out"]);
  });

  it("★ GET + クエリでも動く（本文を送れないサービス向け）", async () => {
    const res = await get("?mode=clock-in", TOKEN);

    expect(res.status).toBe(200);
    expect(h.runCalls).toEqual(["clock-in"]);
  });

  it("★ POST で本文が空でもクエリで動く", async () => {
    const res = await POST(
      new Request(`${URL_BASE}?mode=missing-clock-out`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
    );

    expect(res.status).toBe(200);
    expect(h.runCalls).toEqual(["missing-clock-out"]);
  });

  it("GET でもトークンが無ければ 404", async () => {
    const res = await get("?mode=clock-in");

    expect(res.status).toBe(404);
    expect(h.runCalls).toHaveLength(0);
  });

  it("mode が無ければ 400", async () => {
    const res = await get("", TOKEN);

    expect(res.status).toBe(400);
    expect(h.runCalls).toHaveLength(0);
  });

  it("知らない mode は 400", async () => {
    const res = await get("?mode=everything", TOKEN);

    expect(res.status).toBe(400);
    expect(h.runCalls).toHaveLength(0);
  });
});

describe("★ 応答の中身", () => {
  it("氏名は返さず、件数と結果だけ返す", async () => {
    const res = await post({ mode: "clock-in" }, TOKEN);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body).toEqual({
      mode: "clock-in",
      sent: true,
      skipped: null,
      attendeeCount: 3,
      listedCount: 3,
    });
    expect(body).not.toHaveProperty("text");
  });
});
