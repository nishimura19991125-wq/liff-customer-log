import { readFileSync } from "node:fs";
import path from "node:path";

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
  /**
   * 名簿の所属会社（氏名 → 会社）。null は「名簿から引けなかった」。
   * ここに無い氏名は defaultCompany を返す
   */
  companyByName: {} as Record<string, string | null>,
  defaultCompany: "株式会社トラーチ" as string | null,
  /** 名簿そのものが引けない状況を作る */
  companyLookup: "ok" as "ok" | "not-configured" | "throws",
  /** 所属会社を引いた氏名（誰について名簿を見たか） */
  companyLookupNames: [] as string[],
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

vi.mock("@/lib/staff-workplace-lookup", () => ({
  resolveStaffAssignmentLookupConfig: async () => {
    if (h.companyLookup === "throws") throw new Error("名簿が引けません 社員A");
    if (h.companyLookup === "not-configured") return null;
    return {
      staffAppId: "staff-app",
      nameFieldId: "field-1",
      workplaceFieldId: null,
      companyFieldId: "field-3",
    };
  },
  lookupStaffAssignmentByStaffName: async (staffName: string) => {
    h.companyLookupNames.push(staffName);
    const company =
      staffName in h.companyByName
        ? h.companyByName[staffName]
        : h.defaultCompany;
    return { workplace: null, company };
  },
}));

const { MISSING_CLOCK_OUT_TARGET_COMPANY, runAttendanceListNotification } =
  await import("@/lib/attendance-list-notification-server");

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
  // 既定では全員が対象会社。会社違いは各テストが個別に指定する
  h.companyByName = {};
  h.defaultCompany = "株式会社トラーチ";
  h.companyLookup = "ok";
  h.companyLookupNames = [];
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

/**
 * 未退勤リストは所属会社が「株式会社トラーチ」の人だけを載せる。
 * 出勤者リストと打刻画面の「本日の出勤者」は絞らない。
 */
describe("★ ②-2 未退勤リストは所属会社で絞る", () => {
  beforeEach(() => {
    h.roster = {
      ok: true,
      workDate: "2026-08-21",
      attendees: [
        attendee("社員A", "09:00", null, "DX事業部"),
        attendee("社員B", "09:05", null, "DC事業部"),
        attendee("社員C", "09:10", null, "DC事業部"),
        attendee("社員D", "09:15", "18:00", "DC事業部"),
      ],
    };
    h.companyByName = {
      社員A: "株式会社トラーチ",
      社員B: "株式会社KAGARIBI",
      社員C: null,
      社員D: "株式会社トラーチ",
    };
  });

  it("対象会社は「株式会社トラーチ」", () => {
    expect(MISSING_CLOCK_OUT_TARGET_COMPANY).toBe("株式会社トラーチ");
  });

  it("★ 所属会社が対象会社の人だけが載る", async () => {
    const outcome = await runAttendanceListNotification("missing-clock-out");

    expect(outcome.sent).toBe(true);
    expect(outcome.listedCount).toBe(1);
    expect(h.sentTexts[0]).toBe(
      [
        "▼退勤打刻もれ▼",
        "8/21（金）",
        "以下の方は退勤打刻がされていません。",
        "----------------",
        "【DX事業部】",
        "①社員A",
      ].join("\n"),
    );
  });

  it("★ 他社の人は載らない", async () => {
    await runAttendanceListNotification("missing-clock-out");

    expect(h.sentTexts[0]).not.toContain("社員B");
  });

  it("★ 名簿から会社が引けなかった人は載らない", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await runAttendanceListNotification("missing-clock-out");

    expect(h.sentTexts[0]).not.toContain("社員C");
  });

  it("★ 引けなかった人数だけをログに残す（氏名は出さない）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnSpy.mockClear();

    await runAttendanceListNotification("missing-clock-out");

    const logged = warnSpy.mock.calls.flat().join(" ");
    expect(logged).toContain('"unresolvedCount":1');
    for (const name of ["社員A", "社員B", "社員C", "社員D"]) {
      expect(logged).not.toContain(name);
    }
  });

  it("全員の会社が引けていればログは出さない", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnSpy.mockClear();
    h.companyByName = { 社員C: "株式会社KAGARIBI" };

    await runAttendanceListNotification("missing-clock-out");

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("★ 会社名の前後に空白があっても一致する", async () => {
    h.companyByName = { ...h.companyByName, 社員B: "  株式会社トラーチ　" };

    const outcome = await runAttendanceListNotification("missing-clock-out");

    expect(outcome.listedCount).toBe(2);
    expect(h.sentTexts[0]).toContain("社員B");
  });

  it("★ 全角半角の違いがあっても一致する", async () => {
    // 半角カナ・組文字（㈱ は NFKC で (株) になるため一致しない側）
    h.companyByName = {
      ...h.companyByName,
      社員B: "株式会社ﾄﾗｰﾁ",
      社員C: "㈱トラーチ",
    };

    const outcome = await runAttendanceListNotification("missing-clock-out");

    expect(outcome.listedCount).toBe(2);
    expect(h.sentTexts[0]).toContain("社員B");
    // 完全一致なので、略記は別の会社として扱う
    expect(h.sentTexts[0]).not.toContain("社員C");
  });

  it("部分一致では載せない", async () => {
    h.companyByName = {
      ...h.companyByName,
      社員B: "株式会社トラーチ 大阪",
    };

    const outcome = await runAttendanceListNotification("missing-clock-out");

    expect(outcome.listedCount).toBe(1);
    expect(h.sentTexts[0]).not.toContain("社員B");
  });

  it("★ 対象会社の未退勤が0人なら「全員が退勤打刻済みです」を送る", async () => {
    // 未退勤は他社と会社不明の人だけ
    h.companyByName = { ...h.companyByName, 社員A: "株式会社KAGARIBI" };
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const outcome = await runAttendanceListNotification("missing-clock-out");

    expect(outcome.sent).toBe(true);
    expect(outcome.listedCount).toBe(0);
    // 全社の出勤者数は絞らない
    expect(outcome.attendeeCount).toBe(4);
    expect(h.sentTexts[0]).toBe(
      [
        "▼退勤打刻もれ▼",
        "8/21（金）",
        "----------------",
        "全員が退勤打刻済みです",
      ].join("\n"),
    );
  });

  it("★ 対象会社の出勤者が0人の日も「全員が退勤打刻済みです」を送る", async () => {
    h.companyByName = {};
    h.defaultCompany = "株式会社KAGARIBI";

    const outcome = await runAttendanceListNotification("missing-clock-out");

    expect(outcome.sent).toBe(true);
    expect(h.sentTexts[0]).toContain("全員が退勤打刻済みです");
  });

  it("★ 全社で出勤者0人なら何も送らない（名簿も見ない）", async () => {
    h.roster = { ok: true, workDate: "2026-08-22", attendees: [] };

    const outcome = await runAttendanceListNotification("missing-clock-out");

    expect(outcome.sent).toBe(false);
    expect(outcome.skipped).toBe("no-attendees");
    expect(h.sentTexts).toHaveLength(0);
    expect(h.companyLookupNames).toHaveLength(0);
  });

  /**
   * 未退勤者がいるのに全員の会社が引けないときは送らない。
   * 絞ると0人になり、「全員が退勤打刻済みです」と誤って流れるため。
   */
  it.each(["not-configured", "throws"] as const)(
    "★ 名簿そのものが引けない（%s）ときは送らず、件数だけ残す",
    async (state) => {
      h.companyLookup = state;
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      errorSpy.mockClear();

      const outcome = await runAttendanceListNotification("missing-clock-out");

      expect(outcome.sent).toBe(false);
      expect(outcome.skipped).toBe("company-unresolved");
      expect(outcome.listedCount).toBe(0);
      expect(outcome.attendeeCount).toBe(4);
      expect(h.sentTexts).toHaveLength(0);
      const logged = errorSpy.mock.calls.flat().join(" ");
      expect(logged).toContain("送りません");
      expect(logged).toContain('"unresolvedCount":3');
      expect(logged).toContain('"lookupFailed":true');
      for (const name of ["社員A", "社員B", "社員C", "社員D"]) {
        expect(logged).not.toContain(name);
      }
    },
  );

  it("★ 名簿は引けても未退勤の全員が会社不明なら送らない", async () => {
    h.companyByName = { 社員A: null, 社員B: "", 社員C: "   ", 社員D: null };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    errorSpy.mockClear();

    const outcome = await runAttendanceListNotification("missing-clock-out");

    expect(outcome.sent).toBe(false);
    expect(outcome.skipped).toBe("company-unresolved");
    expect(h.sentTexts).toHaveLength(0);
    const logged = errorSpy.mock.calls.flat().join(" ");
    expect(logged).toContain('"unresolvedCount":3');
    expect(logged).toContain('"lookupFailed":false');
  });

  it("★ dryRun でも同じ判定（本文を作らない）", async () => {
    h.companyLookup = "throws";
    vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await runAttendanceListNotification("missing-clock-out", {
      dryRun: true,
      includeText: true,
    });

    expect(outcome.skipped).toBe("company-unresolved");
    expect(outcome.text).toBeUndefined();
  });

  it.each(["not-configured", "throws"] as const)(
    "★ 未退勤が0人なら、名簿が引けなくても（%s）従来どおり送る",
    async (state) => {
      h.companyLookup = state;
      h.roster = {
        ok: true,
        workDate: "2026-08-21",
        attendees: [
          attendee("社員A", "09:00", "18:00", "DX事業部"),
          attendee("社員B", "09:05", "18:10", "DC事業部"),
        ],
      };
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      errorSpy.mockClear();

      const outcome = await runAttendanceListNotification("missing-clock-out");

      expect(outcome.sent).toBe(true);
      expect(h.sentTexts[0]).toBe(
        [
          "▼退勤打刻もれ▼",
          "8/21（金）",
          "----------------",
          "全員が退勤打刻済みです",
        ].join("\n"),
      );
      // 絞る相手がいないので名簿は見ない。失敗の記録も出ない
      expect(h.companyLookupNames).toHaveLength(0);
      expect(errorSpy).not.toHaveBeenCalled();
    },
  );

  it("★ 一部の人だけ引けないときは、その人を除いて送る", async () => {
    // 社員A は対象会社、社員B・社員C は会社不明
    h.companyByName = { ...h.companyByName, 社員B: null };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnSpy.mockClear();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    errorSpy.mockClear();

    const outcome = await runAttendanceListNotification("missing-clock-out");

    expect(outcome.sent).toBe(true);
    expect(outcome.listedCount).toBe(1);
    expect(h.sentTexts[0]).toContain("社員A");
    expect(h.sentTexts[0]).not.toContain("社員B");
    expect(h.sentTexts[0]).not.toContain("社員C");
    expect(warnSpy.mock.calls.flat().join(" ")).toContain(
      '"unresolvedCount":2',
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("★ 引けた人が全員他社なら「全員が退勤打刻済みです」を送る", async () => {
    // 社員C だけ会社不明。全員が引けないわけではないので送る
    h.companyByName = { ...h.companyByName, 社員A: "株式会社KAGARIBI" };
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const outcome = await runAttendanceListNotification("missing-clock-out");

    expect(outcome.sent).toBe(true);
    expect(h.sentTexts[0]).toContain("全員が退勤打刻済みです");
  });

  it("★ 出勤者リスト（9:32）は絞らない。他社も会社不明の人も載る", async () => {
    const outcome = await runAttendanceListNotification("clock-in");

    expect(outcome.sent).toBe(true);
    expect(outcome.attendeeCount).toBe(4);
    expect(outcome.listedCount).toBe(4);
    expect(h.sentTexts[0]).toBe(
      [
        "▼本日の出勤者▼",
        "8/21（金）",
        "----------------",
        "【DC事業部】",
        "①社員B",
        "②社員C",
        "③社員D",
        "----------------",
        "【DX事業部】",
        "①社員A",
      ].join("\n"),
    );
    // 出勤者リストでは所属会社を引かない
    expect(h.companyLookupNames).toHaveLength(0);
  });

  it("★ 名簿が引けなくても出勤者リストは従来どおり送る", async () => {
    h.companyLookup = "throws";

    const outcome = await runAttendanceListNotification("clock-in");

    expect(outcome.sent).toBe(true);
    expect(outcome.listedCount).toBe(4);
  });
});

/**
 * 打刻画面の「本日の出勤者」は getTodayAttendanceRoster と同じ集計
 * （buildTodayAttendees → finalizeTodayAttendees）を通る。そこへ絞り込みを
 * 足すと画面と出勤者リストまで絞られるので、**足す場所**を固定する。
 * 挙動ではなく配線を見る（対象は文字列一致）。
 */
describe("★ 打刻画面の「本日の出勤者」は絞らない", () => {
  const read = (rel: string) =>
    readFileSync(path.join(process.cwd(), rel), "utf8");

  it("★ 勤怠の集計側は所属会社を見ていない", () => {
    const src = read("src/lib/attendance-server.ts");

    expect(src).not.toContain("MISSING_CLOCK_OUT_TARGET_COMPANY");
    expect(src).not.toContain("lookupStaffAssignmentByStaffName");
    expect(src).not.toContain("attendance-list-notification-server");
  });

  it("★ 絞り込みは未退勤リストの分岐にだけある", () => {
    const src = read("src/lib/attendance-list-notification-server.ts");

    // 呼び出しは1箇所だけ（定義は型引数付きなので数に入らない）
    expect(src.split("keepTargetCompanyOnly(").length - 1).toBe(1);
    expect(src).toMatch(
      /mode === "clock-in"\s*\? roster\.attendees\s*: await keepTargetCompanyOnly\(/,
    );
  });

  it("★ 集計結果（出勤者の配列）を書き換えない", async () => {
    const attendees = [
      attendee("社員A", "09:00", null, "DX事業部"),
      attendee("社員B", "09:05", null, "DC事業部"),
    ];
    const before = JSON.parse(JSON.stringify(attendees));
    h.roster = { ok: true, workDate: "2026-08-21", attendees };
    h.companyByName = { 社員B: "株式会社KAGARIBI" };

    await runAttendanceListNotification("missing-clock-out");

    expect(attendees).toEqual(before);
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
