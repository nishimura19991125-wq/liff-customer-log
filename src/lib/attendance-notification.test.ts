import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * タスクW: 出勤打刻の Google Chat 通知。
 *
 * 打刻を止めないこと（送信の失敗・未設定・例外のいずれでも）と、
 * 出勤のときだけ送ることを見る。
 */

const h = vi.hoisted(() => ({
  configured: true,
  sentTexts: [] as string[],
  result: { kind: "sent" } as
    | { kind: "sent" }
    | { kind: "skipped"; reason: string }
    | { kind: "failed"; reason: string; status?: number },
  throwOnSend: false,
}));

vi.mock("@/lib/google-chat", () => ({
  googleChatAttendanceWebhookConfigured: () => h.configured,
  sendGoogleChatAttendanceMessage: async (text: string) => {
    h.sentTexts.push(text);
    if (h.throwOnSend) throw new Error("想定外 山田太郎");
    return h.result;
  },
}));

const {
  ATTENDANCE_NOTIFICATION_FAILURE_WARNING,
  buildAttendanceClockInMessage,
  notifyAttendanceClockIn,
} = await import("@/lib/attendance-notification");

const BASE = {
  staffName: "西村直也",
  clockIn: "09:15",
  department: "DX事業部",
};

beforeEach(() => {
  h.configured = true;
  h.sentTexts = [];
  h.result = { kind: "sent" };
  h.throwOnSend = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("★ 通知本文", () => {
  it("氏名・部署・時刻が並ぶ", () => {
    expect(buildAttendanceClockInMessage(BASE)).toBe(
      ["🕘 出勤", "氏名：西村直也", "部署：DX事業部", "時刻：09:15"].join("\n"),
    );
  });

  it("部署が無ければ行ごと省く", () => {
    expect(buildAttendanceClockInMessage({ ...BASE, department: "" })).toBe(
      ["🕘 出勤", "氏名：西村直也", "時刻：09:15"].join("\n"),
    );
    expect(
      buildAttendanceClockInMessage({ ...BASE, department: undefined }),
    ).not.toContain("部署");
  });

  it("@pocket の「-」は空として扱う", () => {
    expect(buildAttendanceClockInMessage({ ...BASE, department: "-" })).not.toContain(
      "部署",
    );
  });

  it("日時型の値でも HH:mm に揃える", () => {
    expect(
      buildAttendanceClockInMessage({
        ...BASE,
        clockIn: "2026/08/21 09:15:30",
      }),
    ).toContain("時刻：09:15");
  });

  it("1桁の時刻はゼロ埋めする", () => {
    expect(
      buildAttendanceClockInMessage({ ...BASE, clockIn: "9:05" }),
    ).toContain("時刻：09:05");
  });

  it("時刻が読めなければ行ごと省く", () => {
    expect(
      buildAttendanceClockInMessage({ ...BASE, clockIn: "" }),
    ).toBe(["🕘 出勤", "氏名：西村直也", "部署：DX事業部"].join("\n"));
  });
});

describe("★ ① 出勤打刻で送信される", () => {
  it("本文を組み立てて送る", async () => {
    const outcome = await notifyAttendanceClockIn(BASE);

    expect(outcome).toEqual({ kind: "sent" });
    expect(h.sentTexts).toHaveLength(1);
    expect(h.sentTexts[0]).toContain("🕘 出勤");
    expect(h.sentTexts[0]).toContain("西村直也");
  });

  it("★ ⑥ 氏名はサーバ側で解決した値がそのまま入る", async () => {
    // 呼び出し側（attendance-server）が resolveBoundStaffNameForLineUser の
    // 結果を渡す。ここに来る時点でクライアントの値は混ざらない
    await notifyAttendanceClockIn({ ...BASE, staffName: "冨田菜摘" });

    expect(h.sentTexts[0]).toContain("氏名：冨田菜摘");
  });

  it("氏名が空なら送らない（誰の出勤か分からないため）", async () => {
    const outcome = await notifyAttendanceClockIn({ ...BASE, staffName: "" });

    expect(outcome).toEqual({ kind: "skipped", reason: "no-staff-name" });
    expect(h.sentTexts).toHaveLength(0);
  });
});

describe("★ ④ 環境変数が未設定なら送信をスキップする", () => {
  it("送らず、警告も出さない", async () => {
    h.configured = false;

    const outcome = await notifyAttendanceClockIn(BASE);

    expect(outcome).toEqual({ kind: "skipped", reason: "not-configured" });
    expect(h.sentTexts).toHaveLength(0);
  });
});

describe("★ ⑤ 送信に失敗しても打刻は止めない", () => {
  it("例外を投げず、画面へ出す警告を返す", async () => {
    h.result = { kind: "failed", reason: "http", status: 500 };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await notifyAttendanceClockIn(BASE);

    expect(outcome).toEqual({
      kind: "failed",
      warning: ATTENDANCE_NOTIFICATION_FAILURE_WARNING,
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("タイムアウトでも警告を返すだけ", async () => {
    h.result = { kind: "failed", reason: "timeout" };
    vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await notifyAttendanceClockIn(BASE);

    expect(outcome.kind).toBe("failed");
  });

  it("想定外の例外でも投げ返さない", async () => {
    h.throwOnSend = true;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await notifyAttendanceClockIn(BASE);

    expect(outcome).toEqual({
      kind: "failed",
      warning: ATTENDANCE_NOTIFICATION_FAILURE_WARNING,
    });
    // 例外メッセージには個人情報が載りうるので出さない
    expect(errorSpy.mock.calls[0].join(" ")).not.toContain("山田太郎");
  });

  it("ログに個人情報（氏名・部署）を出さない", async () => {
    h.result = { kind: "failed", reason: "http", status: 403 };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await notifyAttendanceClockIn(BASE);

    const logged = errorSpy.mock.calls[0].join(" ");
    expect(logged).toContain("403");
    expect(logged).not.toContain("西村直也");
    expect(logged).not.toContain("DX事業部");
  });
});
