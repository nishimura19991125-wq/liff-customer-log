import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * タスクX: 稼働終了報告の提出で退勤も打刻する。
 *
 * 打刻が失敗しても報告の提出は成功させること、
 * 既存の退勤打刻を上書きすることを見る。
 */

const h = vi.hoisted(() => ({
  /** punchAttendanceForLineUser の呼び出し引数 */
  punchCalls: [] as Array<{ kind: string; options?: Record<string, unknown> }>,
  punchResult: { ok: true, status: {} } as
    | { ok: true; status: Record<string, unknown> }
    | { ok: false; status: number; error: string },
  punchThrows: false,
  /** 打刻が返ってこない（タイムアウト検証用） */
  punchHangs: false,
  /** @pocket へ書き込んだ報告 */
  createdReports: [] as Array<Record<string, unknown>>,
  /** 本日の既存報告（あると409） */
  existingReports: [] as Array<{ recordId: number; record: Record<string, unknown> }>,
}));

const REPORTER = "field-1";
const REPORT_DATE = "field-2";
const APO_ACTIVITY = "field-3";
const PINPON = "field-4";
const MEETING = "field-5";
const APO = "field-6";
const WORK_AREA = "field-7";

const APP_FIELDS = [
  { uniqueId: REPORTER, caption: "報告者" },
  { uniqueId: REPORT_DATE, caption: "報告日" },
  { uniqueId: APO_ACTIVITY, caption: "アポ活動実施" },
  { uniqueId: PINPON, caption: "ピンポン数" },
  { uniqueId: MEETING, caption: "面談数" },
  { uniqueId: APO, caption: "アポ獲得数" },
  { uniqueId: WORK_AREA, caption: "稼働エリア" },
];

vi.mock("@/lib/atpocket", () => ({
  apiKeyForWorkEndReportPocket: () => "read",
  apiKeyForWorkEndReportPocket1: () => "read1",
  apiKeyForWorkEndReportWrite: () => "write",
  fetchAppFields: async () => APP_FIELDS,
  fetchRecordsList: async () => ({ records: h.existingReports }),
  fetchAllRecordsPages: async () => h.existingReports,
  createRecord: async (
    _appId: string,
    payload: Record<string, unknown>,
  ) => {
    h.createdReports.push(payload);
    return { row: { recordId: 1 }, recordIdHint: "1" };
  },
  isPocketApiRateLimited: () => false,
  isPocketHttpRateLimitError: () => false,
  markPocketApiRateLimited: () => {},
}));

vi.mock("@/lib/staff-bound-lookup", () => ({
  resolveBoundStaffNameForLineUser: async () => "西村直也",
}));

vi.mock("@/lib/staff-department-lookup", () => ({
  lookupStaffDepartmentByStaffName: async () => "DX事業部",
}));

vi.mock("@/lib/attendance-server", () => ({
  punchAttendanceForLineUser: async (
    _lineUserId: string,
    kind: string,
    options?: Record<string, unknown>,
  ) => {
    h.punchCalls.push({ kind, options });
    if (h.punchHangs) {
      return new Promise(() => {
        /* 応答しない */
      });
    }
    if (h.punchThrows) throw new Error("想定外 西村直也");
    return h.punchResult;
  },
}));

const {
  WORK_END_REPORT_CLOCK_OUT_WARNING,
  submitWorkEndReportForLineUser,
} = await import("@/lib/work-end-report-server");

// 一覧の共有キャッシュはモジュール変数。テスト間で持ち越さない
const { invalidateWorkEndReportRowsCache } = await import(
  "@/lib/work-end-report-cache"
);

const FORM = {
  pinponCount: "10",
  meetingCount: "3",
  apoCount: "1",
  apoActivity: "実施",
  workArea: "奈良市",
};

beforeEach(() => {
  invalidateWorkEndReportRowsCache();
  process.env.WORK_END_REPORT_APP_ID = "88";
  delete process.env.WORK_END_REPORT_CLOCK_OUT_TIMEOUT_MS;
  h.punchCalls = [];
  h.punchResult = { ok: true, status: {} };
  h.punchThrows = false;
  h.punchHangs = false;
  h.createdReports = [];
  h.existingReports = [];
});

describe("★ ① 稼働終了報告の提出で退勤が打刻される", () => {
  it("報告を書き込んだあとに退勤打刻を呼ぶ", async () => {
    const result = await submitWorkEndReportForLineUser("U-test", FORM);

    expect(result.ok).toBe(true);
    expect(h.createdReports).toHaveLength(1);
    expect(h.punchCalls).toHaveLength(1);
    expect(h.punchCalls[0].kind).toBe("out");
  });

  it("★ 出勤は打刻しない（退勤のみ）", async () => {
    await submitWorkEndReportForLineUser("U-test", FORM);

    expect(h.punchCalls.map((c) => c.kind)).toEqual(["out"]);
    expect(h.punchCalls.some((c) => c.kind === "in")).toBe(false);
  });

  it("★ ② 既に退勤打刻があっても上書きする", async () => {
    await submitWorkEndReportForLineUser("U-test", FORM);

    expect(h.punchCalls[0].options).toMatchObject({ overwriteClockOut: true });
  });

  it("成功したときは warning を返さない", async () => {
    const result = await submitWorkEndReportForLineUser("U-test", FORM);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warning).toBeUndefined();
  });
});

describe("★ ③ 打刻に失敗しても報告の提出は成功する", () => {
  it("打刻が失敗しても ok:true で warning を返す", async () => {
    h.punchResult = { ok: false, status: 502, error: "打刻に失敗" };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await submitWorkEndReportForLineUser("U-test", FORM);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warning).toBe(WORK_END_REPORT_CLOCK_OUT_WARNING);
      // 手動で復旧できることを伝える
      expect(result.warning).toContain("勤怠画面から打刻してください");
    }
    // 報告は書き込まれている
    expect(h.createdReports).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("打刻が例外を投げても報告は成功する", async () => {
    h.punchThrows = true;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await submitWorkEndReportForLineUser("U-test", FORM);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warning).toBe(WORK_END_REPORT_CLOCK_OUT_WARNING);
    // 例外メッセージには個人情報が載りうるので出さない
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("西村直也");
  });

  it("★ 打刻が応答しなくても報告の応答は返る（タイムアウト）", async () => {
    process.env.WORK_END_REPORT_CLOCK_OUT_TIMEOUT_MS = "20";
    h.punchHangs = true;
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await submitWorkEndReportForLineUser("U-test", FORM);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warning).toBe(WORK_END_REPORT_CLOCK_OUT_WARNING);
    expect(h.createdReports).toHaveLength(1);
  });

  it("ログに個人情報を出さない", async () => {
    h.punchResult = { ok: false, status: 502, error: "打刻に失敗" };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await submitWorkEndReportForLineUser("U-test", FORM);

    const logged = errorSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("502");
    expect(logged).not.toContain("西村直也");
    expect(logged).not.toContain("奈良市");
  });
});

describe("★ 報告の保存が失敗したら打刻しない", () => {
  it("本日すでに報告済みなら 409。打刻も呼ばない", async () => {
    h.existingReports = [
      {
        recordId: 9,
        record: {
          [REPORTER]: "西村直也",
          [REPORT_DATE]: new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Tokyo",
          }).format(new Date()),
        },
      },
    ];

    const result = await submitWorkEndReportForLineUser("U-test", FORM);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect(h.punchCalls).toHaveLength(0);
  });

  it("入力が不正なら打刻も呼ばない", async () => {
    const result = await submitWorkEndReportForLineUser("U-test", {
      ...FORM,
      apoActivity: "",
    });

    expect(result.ok).toBe(false);
    expect(h.createdReports).toHaveLength(0);
    expect(h.punchCalls).toHaveLength(0);
  });
});
