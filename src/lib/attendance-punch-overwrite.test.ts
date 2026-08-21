import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * タスクX: 退勤打刻の上書き（overwriteClockOut）。
 *
 * 稼働終了報告からの退勤だけが既存の退勤時刻を上書きし、
 * 勤怠画面からの手動打刻は従来どおり 409 のままであることを見る。
 */

const h = vi.hoisted(() => ({
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
    return { row: { recordId: 500 }, recordIdHint: "500" };
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

vi.mock("@/lib/staff-workplace-lookup", () => ({
  resolveStaffWorkplaceLookupConfig: async () => null,
  lookupStaffWorkplaceByStaffName: async () => null,
}));

vi.mock("@/lib/attendance-notification", () => ({
  notifyAttendanceClockIn: async () => ({ kind: "sent" }),
}));

const { punchAttendanceForLineUser } = await import("@/lib/attendance-server");
const {
  invalidateAttendanceRosterCache,
  invalidateAttendanceStatusCache,
} = await import("@/lib/attendance-cache");

function todayJst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );
}

/** 本日の勤怠行。clockOut を渡すと退勤済みの状態になる */
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

beforeEach(() => {
  process.env.ATTENDANCE_APP_ID = "99";
  h.todayRows = [];
  h.writes = [];
  invalidateAttendanceStatusCache();
  invalidateAttendanceRosterCache();
});

describe("★ ② 既存の退勤打刻を上書きする（稼働終了報告からの退勤）", () => {
  it("退勤済みでも overwriteClockOut なら成功して書き込む", async () => {
    h.todayRows = [existingRow("09:00", "17:00")];

    const result = await punchAttendanceForLineUser("U-test", "out", {
      overwriteClockOut: true,
    });

    expect(result.ok).toBe(true);
    expect(h.writes).toHaveLength(1);
  });

  it("★ 書き込むのは退勤時刻だけ。出勤時刻には触れない", async () => {
    h.todayRows = [existingRow("09:00", "17:00")];

    await punchAttendanceForLineUser("U-test", "out", {
      overwriteClockOut: true,
    });

    const payload = h.writes[0].payload as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual([CLOCK_OUT]);
    // 新しい時刻で置き換わる（17:00 のままにはしない）
    expect(payload[CLOCK_OUT]).not.toBe("17:00");
    expect(String(payload[CLOCK_OUT])).toMatch(/^\d{2}:\d{2}$/);
  });

  it("退勤がまだのときも従来どおり打刻できる", async () => {
    h.todayRows = [existingRow("09:00")];

    const result = await punchAttendanceForLineUser("U-test", "out", {
      overwriteClockOut: true,
    });

    expect(result.ok).toBe(true);
    expect(h.writes).toHaveLength(1);
  });

  it("★ 出勤打刻が無ければ上書き指定でも打刻しない", async () => {
    h.todayRows = [];

    const result = await punchAttendanceForLineUser("U-test", "out", {
      overwriteClockOut: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain("出勤打刻がありません");
    }
    expect(h.writes).toHaveLength(0);
  });
});

describe("★ ④ 勤怠画面からの手動打刻は従来どおり", () => {
  it("退勤済みで options 無しなら 409 のまま", async () => {
    h.todayRows = [existingRow("09:00", "17:00")];

    const result = await punchAttendanceForLineUser("U-test", "out");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toBe("本日はすでに退勤打刻済みです");
    }
    expect(h.writes).toHaveLength(0);
  });

  it("overwriteClockOut: false を明示しても 409 のまま", async () => {
    h.todayRows = [existingRow("09:00", "17:00")];

    const result = await punchAttendanceForLineUser("U-test", "out", {
      overwriteClockOut: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect(h.writes).toHaveLength(0);
  });

  it("退勤がまだなら options 無しで従来どおり打刻できる", async () => {
    h.todayRows = [existingRow("09:00")];

    const result = await punchAttendanceForLineUser("U-test", "out");

    expect(result.ok).toBe(true);
    expect(h.writes).toHaveLength(1);
  });
});

describe("★ 出勤打刻には影響しない", () => {
  it("出勤済みなら overwriteClockOut を渡しても 409", async () => {
    h.todayRows = [existingRow("09:00")];

    const result = await punchAttendanceForLineUser("U-test", "in", {
      overwriteClockOut: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect(h.writes).toHaveLength(0);
  });
});
