import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * タスクW: 打刻経路から出勤通知が呼ばれる条件。
 *
 * 出勤のときだけ・打刻が成立したときだけ送る。
 * 通知の成否は打刻の成否に影響させない。
 */

const h = vi.hoisted(() => ({
  /** notifyAttendanceClockIn の呼び出し引数 */
  notifyCalls: [] as Array<Record<string, unknown>>,
  /** 通知の結果 */
  notifyOutcome: { kind: "sent" } as
    | { kind: "sent" }
    | { kind: "skipped"; reason: string }
    | { kind: "failed"; warning: string },
  /** @pocket に入っている本日の行 */
  todayRows: [] as Array<{ recordId: number; record: Record<string, unknown> }>,
  writes: [] as Array<Record<string, unknown>>,
}));

const STAFF = "field-1";
const WORK_DATE = "field-2";
const CLOCK_IN = "field-3";
const CLOCK_OUT = "field-4";

const APP_FIELDS = [
  { uniqueId: STAFF, caption: "社員名" },
  { uniqueId: WORK_DATE, caption: "勤怠日" },
  { uniqueId: CLOCK_IN, caption: "出勤時刻", fieldType: "Time" },
  { uniqueId: CLOCK_OUT, caption: "退勤時間", fieldType: "Time" },
];

vi.mock("@/lib/atpocket", () => ({
  apiKeyForAttendancePocket: () => "read",
  apiKeyForAttendancePocket1: () => "read1",
  apiKeyForAttendanceWrite: () => "write",
  fetchAppFields: async () => APP_FIELDS,
  fetchRecordsList: async () => ({ records: h.todayRows }),
  fetchAllRecordsPages: async () => h.todayRows,
  isPocketApiRateLimited: () => false,
  isPocketHttpRateLimitError: () => false,
  markPocketApiRateLimited: () => {},
}));

vi.mock("@/lib/atpocket-write-with-import-key", () => ({
  writePocketRecordWithImportKey: async (opts: Record<string, unknown>) => {
    h.writes.push(opts);
    return { row: { recordId: 777 }, recordIdHint: "777" };
  },
}));

vi.mock("@/lib/staff-bound-lookup", () => ({
  resolveBoundStaffNameForLineUser: async () => "西村直也",
}));

vi.mock("@/lib/staff-department-lookup", () => ({
  enrichStaffNamesWithDepartments: async (
    items: Array<{ staffName: string }>,
  ) => items.map((i) => ({ ...i, department: "DX事業部" })),
}));

vi.mock("@/lib/attendance-notification", () => ({
  notifyAttendanceClockIn: async (input: Record<string, unknown>) => {
    h.notifyCalls.push(input);
    return h.notifyOutcome;
  },
}));

const { punchAttendanceForLineUser } = await import(
  "@/lib/attendance-server"
);
// 打刻するとモジュール内キャッシュに状態が残るので、テストごとに捨てる
const {
  invalidateAttendanceRosterCache,
  invalidateAttendanceStatusCache,
} = await import("@/lib/attendance-cache");

function existingRow(clockIn: string, clockOut = "") {
  return {
    recordId: 500,
    record: {
      [STAFF]: "西村直也",
      [WORK_DATE]: todayJst(),
      [CLOCK_IN]: clockIn,
      ...(clockOut ? { [CLOCK_OUT]: clockOut } : {}),
    },
  };
}

function todayJst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );
}

beforeEach(() => {
  process.env.ATTENDANCE_APP_ID = "99";
  h.notifyCalls = [];
  h.notifyOutcome = { kind: "sent" };
  h.todayRows = [];
  h.writes = [];
  invalidateAttendanceStatusCache();
  invalidateAttendanceRosterCache();
});

describe("★ ① 出勤打刻で通知される", () => {
  it("新規レコード作成の経路で呼ばれる", async () => {
    const result = await punchAttendanceForLineUser("U-test", "in");

    expect(result.ok).toBe(true);
    expect(h.notifyCalls).toHaveLength(1);
  });

  it("★ ⑥ 氏名はサーバで解決した値。部署も名簿から入る", async () => {
    await punchAttendanceForLineUser("U-test", "in");

    expect(h.notifyCalls[0]).toMatchObject({
      staffName: "西村直也",
      department: "DX事業部",
    });
    expect(String(h.notifyCalls[0].clockIn)).toMatch(/^\d{2}:\d{2}$/);
  });

  it("既存レコードを更新する経路でも呼ばれる", async () => {
    // 出勤時刻が空の行が既にある（勤怠日だけ先に入っている等）
    h.todayRows = [existingRow("")];

    const result = await punchAttendanceForLineUser("U-test", "in");

    expect(result.ok).toBe(true);
    expect(h.notifyCalls).toHaveLength(1);
  });

  it("★ ⑤ 通知に失敗しても打刻は成功し、warning を返す", async () => {
    h.notifyOutcome = {
      kind: "failed",
      warning: "出勤通知の送信に失敗しました。",
    };

    const result = await punchAttendanceForLineUser("U-test", "in");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warning).toBe("出勤通知の送信に失敗しました。");
    }
    // 打刻そのものは書き込まれている
    expect(h.writes).toHaveLength(1);
  });

  it("通知が成功すれば warning は付かない", async () => {
    const result = await punchAttendanceForLineUser("U-test", "in");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warning).toBeUndefined();
  });
});

describe("★ ② 退勤打刻では通知されない", () => {
  it("出勤済みから退勤しても呼ばれない", async () => {
    h.todayRows = [existingRow("09:15")];

    const result = await punchAttendanceForLineUser("U-test", "out");

    expect(result.ok).toBe(true);
    expect(h.notifyCalls).toHaveLength(0);
    expect(h.writes).toHaveLength(1);
  });
});

describe("★ ③ すでに打刻済みなら通知されない", () => {
  it("出勤済みで再度出勤すると 409。通知も書き込みもしない", async () => {
    h.todayRows = [existingRow("09:15")];

    const result = await punchAttendanceForLineUser("U-test", "in");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain("すでに出勤打刻済み");
    }
    expect(h.notifyCalls).toHaveLength(0);
    expect(h.writes).toHaveLength(0);
  });

  it("退勤済みで再度退勤しても 409。通知は無い", async () => {
    h.todayRows = [existingRow("09:15", "18:00")];

    const result = await punchAttendanceForLineUser("U-test", "out");

    expect(result.ok).toBe(false);
    expect(h.notifyCalls).toHaveLength(0);
  });

  it("出勤前に退勤しようとしても 409。通知は無い", async () => {
    const result = await punchAttendanceForLineUser("U-test", "out");

    expect(result.ok).toBe(false);
    expect(h.notifyCalls).toHaveLength(0);
  });
});
