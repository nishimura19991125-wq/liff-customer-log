import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 勤怠カレンダー API に休みを足す（休暇・段階2）。
 *
 * 勤怠アプリ（99）と休暇アプリ（199）の取得は、appId で振り分けて数える。
 * 休暇は段階1の fetchLeaveMonth（年月だけのキャッシュ）をそのまま通す。
 */

const h = vi.hoisted(() => ({
  /** lineUserId → 名簿の担当者名 */
  bound: new Map<string, string>(),
  attendanceRows: [] as unknown[],
  leaveRows: [] as unknown[],
  /** 勤怠の問い合わせのうち、失敗させるもの（range: 月で絞る / staff: 本人だけ） */
  attendanceFail: new Set<"range" | "staff">(),
  attendance429: false,
  leaveFail: false,
  calls: { attendance: 0, leave: 0 },
}));

const ATT_FIELDS = [
  { uniqueId: "field-1", caption: "社員名" },
  { uniqueId: "field-2", caption: "勤怠日" },
  { uniqueId: "field-3", caption: "出勤時刻", fieldType: "Time" },
  { uniqueId: "field-4", caption: "退勤時間", fieldType: "Time" },
];
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
    apiKeyForAttendancePocket: () => "read",
    apiKeyForAttendancePocket1: () => "read1",
    apiKeyForAttendanceWrite: () => "write",
    apiKeyForAppFields: () => "leave-key",
    fetchAppFields: async (appId: string) =>
      appId === "199" ? LEAVE_FIELDS : ATT_FIELDS,
    fetchAllRecordsPages: async (appId: string, _csv: string, _auth: unknown, query: string) => {
      if (appId === "199") {
        h.calls.leave++;
        if (h.leaveFail) throw new Error("@pocket 500");
        return h.leaveRows;
      }
      h.calls.attendance++;
      if (h.attendance429) {
        const e = new Error("@pocket 429") as Error & { status: number };
        e.status = 429;
        throw e;
      }
      const kind = query.includes(" and ") ? "range" : "staff";
      if (h.attendanceFail.has(kind)) throw new Error("@pocket 500");
      return h.attendanceRows;
    },
    isPocketApiRateLimited: () => false,
    isPocketHttpRateLimitError: (e: unknown) =>
      Boolean(e && typeof e === "object" && (e as { status?: number }).status === 429),
    markPocketApiRateLimited: () => {},
  };
});

vi.mock("@/lib/staff-bound-lookup", () => ({
  resolveBoundStaffNameForLineUser: async (lineUserId: string) =>
    h.bound.get(lineUserId) ?? null,
}));

const { getAttendanceMonthCalendarForLineUser } = await import(
  "@/lib/attendance-server"
);
const { invalidateLeaveCache } = await import("@/lib/leave-server");

const ME = "社員A";
const OTHER = "社員B";

function attRow(id: number, name: string, date: string) {
  return {
    recordId: id,
    record: { "field-1": name, "field-2": date, "field-3": "09:00", "field-4": "18:00" },
  };
}
function leaveRow(id: number, name: string, date: string) {
  return {
    recordId: id,
    record: { "field-1": name, "field-2": "有給", "field-3": String(id), "field-4": date },
  };
}
/** 種別を指定できる版 */
function leaveRowT(id: number, name: string, date: string, type: string) {
  return {
    recordId: id,
    record: { "field-1": name, "field-2": type, "field-3": String(id), "field-4": date },
  };
}

beforeEach(() => {
  process.env.ATTENDANCE_APP_ID = "99";
  process.env.LEAVE_APP_ID = "199";
  process.env.LEAVE_ATPOCKET_API_KEY = "leave-key";
  for (const k of [
    "LEAVE_STAFF_NAME_FIELD_ID",
    "LEAVE_TYPE_FIELD_ID",
    "LEAVE_DATE_FIELD_ID",
    "LEAVE_IMPORT_KEY_FIELD_ID",
  ]) {
    delete process.env[k];
  }
  h.bound = new Map([["U-me", ME]]);
  h.attendanceRows = [attRow(1, ME, "2026-10-01")];
  h.leaveRows = [];
  h.attendanceFail = new Set();
  h.attendance429 = false;
  h.leaveFail = false;
  h.calls = { attendance: 0, leave: 0 };
  invalidateLeaveCache();
});

describe("★ 本人の休みだけを返す", () => {
  it("★ 本人の休みの日付だけが leaves に入る", async () => {
    h.leaveRows = [
      leaveRow(1, ME, "2026/10/05"),
      leaveRow(2, OTHER, "2026/10/06"),
      leaveRow(3, ME, "2026/10/20"),
    ];
    const res = await getAttendanceMonthCalendarForLineUser("U-me", 2026, 10);
    expect(res.leavesStatus).toBe("ok");
    expect(res.leaves).toEqual(["2026-10-05", "2026-10-20"]);
  });

  it("★ 他人の休みも、他人の氏名も応答に含まれない", async () => {
    h.leaveRows = [leaveRow(1, ME, "2026/10/05"), leaveRow(2, OTHER, "2026/10/06")];
    const res = await getAttendanceMonthCalendarForLineUser("U-me", 2026, 10);
    expect(res.leaves).not.toContain("2026-10-06");
    expect(JSON.stringify(res)).not.toContain(OTHER);
  });

  it("★ 本人の種別だけを出し、他人の種別やレコードIDは出さない", async () => {
    // 休暇種別を表示するため、本人の種別は返す（以前は日付だけだった）
    h.leaveRows = [
      leaveRowT(1, ME, "2026/10/05", "有給"),
      leaveRowT(2, OTHER, "2026/10/06", "忌引き"),
      leaveRowT(3, OTHER, "2026/10/05", "欠勤"),
    ];
    const res = await getAttendanceMonthCalendarForLineUser("U-me", 2026, 10);
    expect(res.leaves).toEqual(["2026-10-05"]);
    expect(res.leaveTypes).toEqual({ "2026-10-05": "有給" });
    const text = JSON.stringify(res);
    expect(text).not.toContain("忌引き");
    expect(text).not.toContain("欠勤");
    expect(text).not.toContain("recordId");
    expect(text).not.toContain("kyuka");
  });

  it("★ 氏名の前後に空白があっても一致する", async () => {
    h.leaveRows = [leaveRow(1, `  ${ME}　`, "2026/10/05")];
    const res = await getAttendanceMonthCalendarForLineUser("U-me", 2026, 10);
    expect(res.leaves).toEqual(["2026-10-05"]);
  });

  it("★ 全角半角の違いがあっても一致する", async () => {
    h.bound = new Map([["U-me", "ｼｬｲﾝA"]]);
    h.attendanceRows = [];
    h.leaveRows = [leaveRow(1, "シャインＡ", "2026/10/05")];
    const res = await getAttendanceMonthCalendarForLineUser("U-me", 2026, 10);
    expect(res.leaves).toEqual(["2026-10-05"]);
  });

  it("同じ日が2件あっても1つにまとめる", async () => {
    h.leaveRows = [leaveRow(1, ME, "2026/10/05"), leaveRow(2, ME, "2026/10/05")];
    const res = await getAttendanceMonthCalendarForLineUser("U-me", 2026, 10);
    expect(res.leaves).toEqual(["2026-10-05"]);
  });
});

describe("★ leavesStatus は fetchLeaveMonth の結果をそのまま伝える", () => {
  it("★ 取れたら ok", async () => {
    const res = await getAttendanceMonthCalendarForLineUser("U-me", 2026, 10);
    expect(res.leavesStatus).toBe("ok");
    expect(res.leaves).toEqual([]);
  });

  it("★ 休暇アプリが未設定なら disabled（エラーにしない）", async () => {
    delete process.env.LEAVE_APP_ID;
    const res = await getAttendanceMonthCalendarForLineUser("U-me", 2026, 10);
    expect(res.leavesStatus).toBe("disabled");
    expect(res.leaves).toEqual([]);
    expect(res.configError).toBeUndefined();
  });

  it("★ 取得に失敗したら error で、leaves は空の配列ではない", async () => {
    h.leaveFail = true;
    const res = await getAttendanceMonthCalendarForLineUser("U-me", 2026, 10);
    expect(res.leavesStatus).toBe("error");
    expect(res.leaves).toBeNull();
  });

  it("★ 休暇の失敗で打刻の結果は落とさない", async () => {
    h.leaveFail = true;
    const res = await getAttendanceMonthCalendarForLineUser("U-me", 2026, 10);
    expect(res.records).toHaveLength(1);
    expect(res.recordsComplete).toBe(true);
  });
});

describe("★ 既存の項目がすべて残っている", () => {
  it("★ configured・year・month・staffName・records は従来どおり", async () => {
    const res = await getAttendanceMonthCalendarForLineUser("U-me", 2026, 10);
    expect(res.configured).toBe(true);
    expect(res.year).toBe(2026);
    expect(res.month).toBe(10);
    expect(res.staffName).toBe(ME);
    expect(res.records).toEqual([
      { id: "1", date: "2026-10-01", checkIn: "09:00", checkOut: "18:00" },
    ]);
  });

  it("★ 紐付けが無いときは従来どおり needsStaffBind", async () => {
    const res = await getAttendanceMonthCalendarForLineUser("U-none", 2026, 10);
    expect(res.needsStaffBind).toBe(true);
    expect(res.records).toEqual([]);
    expect(res.configError).toBe("担当者の紐付けが必要です");
  });
});

describe("★ 利用者が増えても @pocket への問い合わせは増えない", () => {
  it("★ 5人が同じ月を開いても、休暇アプリへの問い合わせは1回", async () => {
    h.bound = new Map(
      ["U1", "U2", "U3", "U4", "U5"].map((id, i) => [id, `社員${i}`] as [string, string]),
    );
    for (const id of h.bound.keys()) {
      await getAttendanceMonthCalendarForLineUser(id, 2026, 10);
    }
    expect(h.calls.leave).toBe(1);
  });

  it("同時に開いても1回", async () => {
    h.bound = new Map([["U1", "社員1"], ["U2", "社員2"], ["U3", "社員3"]]);
    await Promise.all(
      ["U1", "U2", "U3"].map((id) => getAttendanceMonthCalendarForLineUser(id, 2026, 10)),
    );
    expect(h.calls.leave).toBe(1);
  });
});

describe("★ records の取得が完全だったか（recordsComplete）", () => {
  it("★ 月で絞った問い合わせが取れたら true", async () => {
    const res = await getAttendanceMonthCalendarForLineUser("U-me", 2026, 10);
    expect(res.recordsComplete).toBe(true);
  });

  it("★ 打刻が無い月でも、問い合わせが成功していれば true（空は「打刻なし」）", async () => {
    h.attendanceRows = [];
    const res = await getAttendanceMonthCalendarForLineUser("U-me", 2026, 10);
    expect(res.records).toEqual([]);
    expect(res.recordsComplete).toBe(true);
  });

  it("★ 月の問い合わせが落ちても、本人だけの問い合わせで取れたら true", async () => {
    h.attendanceFail = new Set(["range"]);
    const res = await getAttendanceMonthCalendarForLineUser("U-me", 2026, 10);
    expect(res.records).toHaveLength(1);
    expect(res.recordsComplete).toBe(true);
  });

  it("★ 月の問い合わせが0件で、本人だけの問い合わせが落ちたら false", async () => {
    h.attendanceRows = [];
    h.attendanceFail = new Set(["staff"]);
    const res = await getAttendanceMonthCalendarForLineUser("U-me", 2026, 10);
    expect(res.records).toEqual([]);
    expect(res.recordsComplete).toBe(false);
  });

  it("★ 両方落ちたら false（空の records を「打刻なし」と見せない）", async () => {
    h.attendanceFail = new Set(["range", "staff"]);
    const res = await getAttendanceMonthCalendarForLineUser("U-me", 2026, 10);
    expect(res.records).toEqual([]);
    expect(res.recordsComplete).toBe(false);
  });

  it("★ 紐付けが無いときは false", async () => {
    const res = await getAttendanceMonthCalendarForLineUser("U-none", 2026, 10);
    expect(res.recordsComplete).toBe(false);
  });

  it("★ 429 のときは false（rateLimited も従来どおり立つ）", async () => {
    h.attendance429 = true;
    const res = await getAttendanceMonthCalendarForLineUser("U-me", 2026, 10);
    expect(res.rateLimited).toBe(true);
    expect(res.records).toEqual([]);
    expect(res.recordsComplete).toBe(false);
  });
});

describe("★ 休暇種別（leaveTypes）", () => {
  it("★ 種別（field-2）を読み、日付ごとに本人の種別を返す", async () => {
    h.leaveRows = [
      leaveRowT(1, ME, "2026/10/05", "休み"),
      leaveRowT(2, ME, "2026/10/06", "有給"),
      leaveRowT(3, ME, "2026/10/07", "忌引き"),
      leaveRowT(4, ME, "2026/10/08", "欠勤"),
    ];
    const res = await getAttendanceMonthCalendarForLineUser("U-me", 2026, 10);
    expect(res.leaveTypes).toEqual({
      "2026-10-05": "休み",
      "2026-10-06": "有給",
      "2026-10-07": "忌引き",
      "2026-10-08": "欠勤",
    });
  });

  it("★ leaveTypes に他人の分が混ざらない（同じ日でも、本人に休暇が無い日でも）", async () => {
    h.leaveRows = [
      leaveRowT(1, ME, "2026/10/05", "休み"),
      leaveRowT(2, OTHER, "2026/10/05", "忌引き"),
      leaveRowT(3, OTHER, "2026/10/09", "有給"),
      leaveRowT(4, `  ${OTHER}　`, "2026/10/10", "欠勤"),
    ];
    const res = await getAttendanceMonthCalendarForLineUser("U-me", 2026, 10);
    expect(res.leaveTypes).toEqual({ "2026-10-05": "休み" });
    expect(Object.keys(res.leaveTypes ?? {})).toEqual(res.leaves);
  });

  it("★ 同じ日に複数あれば 忌引き > 欠勤 > 有給 > 知らない種別 > 休み で1つ", async () => {
    h.leaveRows = [
      leaveRowT(1, ME, "2026/10/05", "休み"),
      leaveRowT(2, ME, "2026/10/05", "有給"),
      leaveRowT(3, ME, "2026/10/06", "特別休暇"),
      leaveRowT(4, ME, "2026/10/06", "休み"),
      leaveRowT(5, ME, "2026/10/07", "有給"),
      leaveRowT(6, ME, "2026/10/07", "忌引き"),
    ];
    const res = await getAttendanceMonthCalendarForLineUser("U-me", 2026, 10);
    expect(res.leaveTypes).toEqual({
      "2026-10-05": "有給",
      "2026-10-06": "特別休暇",
      "2026-10-07": "忌引き",
    });
  });

  it("★ 取得に失敗したら leaveTypes も null（空で「休暇なし」と見せない）", async () => {
    h.leaveFail = true;
    const res = await getAttendanceMonthCalendarForLineUser("U-me", 2026, 10);
    expect(res.leaveTypes).toBeNull();
  });

  it("休暇アプリが未設定なら leaveTypes は空", async () => {
    delete process.env.LEAVE_APP_ID;
    const res = await getAttendanceMonthCalendarForLineUser("U-me", 2026, 10);
    expect(res.leaveTypes).toEqual({});
  });
});
