import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * タスクY: 定時リストの送信判断。
 *
 * 誰を載せるか、いつ送らないか、@pocket を何回叩くかを見る。
 */

const h = vi.hoisted(() => ({
  /** getTodayAttendanceRoster の戻り */
  roster: {
    ok: true,
    workDate: "2026-08-21",
    attendees: [] as Array<{
      staffName: string;
      clockIn: string;
      clockOut: string | null;
      department?: string;
    }>,
  } as
    | {
        ok: true;
        workDate: string;
        attendees: Array<{
          staffName: string;
          clockIn: string;
          clockOut: string | null;
          department?: string;
        }>;
      }
    | { ok: false; reason: string; error: string },
  /** 勤怠取得の呼び出し引数（何回叩いたか） */
  rosterCalls: [] as Array<Record<string, unknown> | undefined>,
  /** Google Chat へ送った本文 */
  sentTexts: [] as string[],
  sendResult: { kind: "sent" } as
    | { kind: "sent" }
    | { kind: "skipped"; reason: string }
    | { kind: "failed"; reason: string; status?: number },
  departmentOrder: [] as string[],
  departmentOrderThrows: false,
}));

vi.mock("@/lib/attendance-server", () => ({
  getTodayAttendanceRoster: async (options?: Record<string, unknown>) => {
    h.rosterCalls.push(options);
    return h.roster;
  },
}));

vi.mock("@/lib/google-chat", () => ({
  googleChatAttendanceListWebhookConfigured: () =>
    Boolean(process.env.GOOGLE_CHAT_ATTENDANCE_LIST_WEBHOOK_URL?.trim()),
  sendGoogleChatAttendanceListMessage: async (text: string) => {
    h.sentTexts.push(text);
    return h.sendResult;
  },
}));

vi.mock("@/lib/staff-department-lookup", () => ({
  listStaffDepartmentsInRosterOrder: async () => {
    if (h.departmentOrderThrows) throw new Error("名簿が引けません");
    return h.departmentOrder;
  },
}));

const { runAttendanceListNotification } = await import(
  "@/lib/attendance-list-notification-server"
);

function attendee(
  staffName: string,
  clockIn: string,
  clockOut: string | null,
  department?: string,
) {
  return { staffName, clockIn, clockOut, department };
}

beforeEach(() => {
  process.env.GOOGLE_CHAT_ATTENDANCE_LIST_WEBHOOK_URL = "https://example.test/x";
  h.roster = { ok: true, workDate: "2026-08-21", attendees: [] };
  h.rosterCalls = [];
  h.sentTexts = [];
  h.sendResult = { kind: "sent" };
  h.departmentOrder = ["DC事業部", "DX事業部"];
  h.departmentOrderThrows = false;
});

describe("★ ① 出勤者リストの送信", () => {
  it("出勤者を部署ごとに並べて送る", async () => {
    h.roster = {
      ok: true,
      workDate: "2026-08-21",
      attendees: [
        attendee("西村直也", "09:15", null, "DX事業部"),
        attendee("丸山龍生", "08:50", "18:00", "DC事業部"),
      ],
    };

    const outcome = await runAttendanceListNotification("clock-in");

    expect(outcome.sent).toBe(true);
    expect(h.sentTexts).toHaveLength(1);
    expect(h.sentTexts[0]).toBe(
      [
        "▼本日の出勤者▼",
        "8/21（金）",
        "----------------",
        "【DC事業部】",
        "①丸山龍生",
        "----------------",
        "【DX事業部】",
        "①西村直也",
      ].join("\n"),
    );
  });

  it("★ 退勤済みの人も出勤者リストには載る", async () => {
    h.roster = {
      ok: true,
      workDate: "2026-08-21",
      attendees: [attendee("丸山龍生", "08:50", "18:00", "DC事業部")],
    };

    await runAttendanceListNotification("clock-in");

    expect(h.sentTexts[0]).toContain("丸山龍生");
  });

  it("★ @pocket の取得は1回だけ（キャッシュは通さない）", async () => {
    h.roster = {
      ok: true,
      workDate: "2026-08-21",
      attendees: [attendee("西村直也", "09:15", null, "DX事業部")],
    };

    await runAttendanceListNotification("clock-in");

    expect(h.rosterCalls).toHaveLength(1);
    expect(h.rosterCalls[0]).toMatchObject({ bypassCache: true });
  });
});

describe("★ ② 未退勤リストの送信", () => {
  beforeEach(() => {
    h.roster = {
      ok: true,
      workDate: "2026-08-21",
      attendees: [
        attendee("西村直也", "09:15", null, "DX事業部"),
        attendee("丸山龍生", "08:50", "18:00", "DC事業部"),
        attendee("岩田陽紀", "09:00", null, "DC事業部"),
      ],
    };
  });

  it("退勤打刻がない人だけを載せる", async () => {
    const outcome = await runAttendanceListNotification("missing-clock-out");

    expect(outcome.sent).toBe(true);
    expect(outcome.attendeeCount).toBe(3);
    expect(outcome.listedCount).toBe(2);
    expect(h.sentTexts[0]).toContain("西村直也");
    expect(h.sentTexts[0]).toContain("岩田陽紀");
    // 退勤済みは載らない
    expect(h.sentTexts[0]).not.toContain("丸山龍生");
  });

  it("★ ④ 出勤打刻がない人は含まれない", async () => {
    // getTodayAttendanceRoster は出勤打刻がある人しか返さない。
    // 休みの人が毎日並ばないのは、この前提に乗っているため
    h.roster = {
      ok: true,
      workDate: "2026-08-21",
      attendees: [attendee("西村直也", "09:15", null, "DX事業部")],
    };

    const outcome = await runAttendanceListNotification("missing-clock-out");

    expect(outcome.listedCount).toBe(1);
    expect(h.sentTexts[0]).toContain("西村直也");
  });
});

describe("★ ③ 対象者が0人のとき", () => {
  it("出勤者0人なら出勤者リストを送らない", async () => {
    h.roster = { ok: true, workDate: "2026-08-22", attendees: [] };

    const outcome = await runAttendanceListNotification("clock-in");

    expect(outcome.sent).toBe(false);
    expect(outcome.skipped).toBe("no-attendees");
    expect(h.sentTexts).toHaveLength(0);
  });

  it("未退勤0人なら「全員が退勤打刻済みです」を送る", async () => {
    h.roster = {
      ok: true,
      workDate: "2026-08-21",
      attendees: [attendee("丸山龍生", "08:50", "18:00", "DC事業部")],
    };

    const outcome = await runAttendanceListNotification("missing-clock-out");

    expect(outcome.sent).toBe(true);
    expect(h.sentTexts[0]).toContain("全員が退勤打刻済みです");
  });

  it("★ その日の出勤者自体が0人なら未退勤リストも送らない", async () => {
    h.roster = { ok: true, workDate: "2026-08-22", attendees: [] };

    const outcome = await runAttendanceListNotification("missing-clock-out");

    expect(outcome.sent).toBe(false);
    expect(outcome.skipped).toBe("no-attendees");
    expect(h.sentTexts).toHaveLength(0);
  });
});

describe("★ ⑤ 環境変数が未設定のとき", () => {
  it("Webhook が未設定なら送信をスキップし、@pocket も叩かない", async () => {
    delete process.env.GOOGLE_CHAT_ATTENDANCE_LIST_WEBHOOK_URL;
    h.roster = {
      ok: true,
      workDate: "2026-08-21",
      attendees: [attendee("西村直也", "09:15", null, "DX事業部")],
    };

    const outcome = await runAttendanceListNotification("clock-in");

    expect(outcome.sent).toBe(false);
    expect(outcome.skipped).toBe("not-configured");
    expect(h.sentTexts).toHaveLength(0);
    // 送り先が無いのに取得だけするのは無駄。上限を食わない
    expect(h.rosterCalls).toHaveLength(0);
  });

  it("空文字でもスキップする", async () => {
    process.env.GOOGLE_CHAT_ATTENDANCE_LIST_WEBHOOK_URL = "   ";

    const outcome = await runAttendanceListNotification("clock-in");

    expect(outcome.skipped).toBe("not-configured");
  });
});

describe("★ 失敗しても投げない", () => {
  it("勤怠の取得に失敗したら送らずに終わる", async () => {
    h.roster = { ok: false, reason: "rate-limited", error: "上限です" };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await runAttendanceListNotification("clock-in");

    expect(outcome.sent).toBe(false);
    expect(outcome.skipped).toBe("rate-limited");
    expect(h.sentTexts).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("★ 送信に失敗しても例外を投げない。URL も氏名も出さない", async () => {
    h.roster = {
      ok: true,
      workDate: "2026-08-21",
      attendees: [attendee("西村直也", "09:15", null, "DX事業部")],
    };
    h.sendResult = { kind: "failed", reason: "http", status: 503 };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await runAttendanceListNotification("clock-in");

    expect(outcome.sent).toBe(false);
    expect(outcome.skipped).toBe("send-failed");
    const logged = errorSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("503");
    expect(logged).not.toContain("西村直也");
    expect(logged).not.toContain("example.test");
  });

  it("★ 名簿の並び順が引けなくても送る", async () => {
    h.departmentOrderThrows = true;
    h.roster = {
      ok: true,
      workDate: "2026-08-21",
      attendees: [attendee("西村直也", "09:15", null, "DX事業部")],
    };

    const outcome = await runAttendanceListNotification("clock-in");

    expect(outcome.sent).toBe(true);
    expect(h.sentTexts[0]).toContain("【DX事業部】");
  });
});

describe("★ 調査用ルート向けの動き", () => {
  it("dryRun なら送らずに本文だけ返す", async () => {
    h.roster = {
      ok: true,
      workDate: "2026-08-21",
      attendees: [attendee("西村直也", "09:15", null, "DX事業部")],
    };

    const outcome = await runAttendanceListNotification("clock-in", {
      dryRun: true,
      includeText: true,
    });

    expect(outcome.sent).toBe(false);
    expect(outcome.skipped).toBe("dry-run");
    expect(outcome.text).toContain("西村直也");
    expect(h.sentTexts).toHaveLength(0);
  });

  it("★ 既定では本文を持ち回らない（氏名を漏らさない）", async () => {
    h.roster = {
      ok: true,
      workDate: "2026-08-21",
      attendees: [attendee("西村直也", "09:15", null, "DX事業部")],
    };

    const outcome = await runAttendanceListNotification("clock-in");

    expect(outcome.text).toBeUndefined();
  });

  it("Webhook 未設定でも dryRun なら本文を確認できる", async () => {
    delete process.env.GOOGLE_CHAT_ATTENDANCE_LIST_WEBHOOK_URL;
    h.roster = {
      ok: true,
      workDate: "2026-08-21",
      attendees: [attendee("西村直也", "09:15", null, "DX事業部")],
    };

    const outcome = await runAttendanceListNotification("clock-in", {
      dryRun: true,
      includeText: true,
    });

    expect(outcome.text).toContain("西村直也");
  });
});

describe("★ 打刻通知とは別の Webhook を使う", () => {
  it("GOOGLE_CHAT_ATTENDANCE_LIST_WEBHOOK_URL を見る", async () => {
    const actual = await vi.importActual<
      typeof import("@/lib/google-chat")
    >("@/lib/google-chat");

    const prevList = process.env.GOOGLE_CHAT_ATTENDANCE_LIST_WEBHOOK_URL;
    const prevPunch = process.env.GOOGLE_CHAT_ATTENDANCE_WEBHOOK_URL;
    try {
      delete process.env.GOOGLE_CHAT_ATTENDANCE_LIST_WEBHOOK_URL;
      // 打刻通知の側だけ設定しても、定時リストは未設定のまま
      process.env.GOOGLE_CHAT_ATTENDANCE_WEBHOOK_URL = "https://example.test/punch";
      expect(actual.googleChatAttendanceListWebhookConfigured()).toBe(false);

      process.env.GOOGLE_CHAT_ATTENDANCE_LIST_WEBHOOK_URL =
        "https://example.test/list";
      expect(actual.googleChatAttendanceListWebhookConfigured()).toBe(true);
    } finally {
      if (prevList) process.env.GOOGLE_CHAT_ATTENDANCE_LIST_WEBHOOK_URL = prevList;
      if (prevPunch) process.env.GOOGLE_CHAT_ATTENDANCE_WEBHOOK_URL = prevPunch;
      else delete process.env.GOOGLE_CHAT_ATTENDANCE_WEBHOOK_URL;
    }
  });
});
