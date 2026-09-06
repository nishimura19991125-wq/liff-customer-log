import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 打刻の書き込みが 429 になったときの扱い（段階3）。
 *
 * 読み取りには前からバックオフとジッターが入っていたが、書き込みは
 * 素の fetch 1発で、落ちると @pocket の生メッセージ
 * （`@pocket update record failed: 429 … | appsId=… | apiKey=…`）が
 * そのまま画面に出ていた。
 *
 * ここで固定するのは3つ。
 *   1. 429 のときだけ、**1回だけ**入れ直す
 *   2. 400・403・500 は入れ直さない（結果が変わらず、二重書き込みが危険）
 *   3. 画面に出るのは固定文言＋相関IDだけ。生メッセージはログへ
 */

const h = vi.hoisted(() => ({
  todayRows: [] as Array<{ recordId: number; record: Record<string, unknown> }>,
  /** 書き込みの試行（何回投げたか） */
  writeAttempts: [] as Array<Record<string, unknown>>,
  /** 各試行で投げるエラー。null なら成功 */
  writeErrors: [] as Array<Error | null>,
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

/** 実物と同じ形。appsId や環境変数名まで載っている */
const RAW_429 =
  "@pocket update record failed: 429 Too Many Requests | operation=attendance | appsId=99 | apiKey=ATTENDANCE_ATPOCKET_API_KEY_2";

function pocket429(retryAfterMs?: number): Error {
  const e: Error & { status?: number; retryAfterMs?: number } = new Error(
    RAW_429,
  );
  e.status = 429;
  if (retryAfterMs != null) e.retryAfterMs = retryAfterMs;
  return e;
}

vi.mock("@/lib/atpocket", () => ({
  apiKeyForAttendancePocket: () => "read",
  apiKeyForAttendancePocket1: () => "read1",
  apiKeyForAttendanceWrite: () => "write",
  fetchAppFields: async () => APP_FIELDS,
  fetchRecordsList: async () => ({ records: h.todayRows }),
  fetchAllRecordsPages: async () => h.todayRows,
  isPocketApiRateLimited: () => false,
  // 本物と同じ判定（メッセージに 429 が入っているか）
  isPocketHttpRateLimitError: (e: unknown) =>
    (e instanceof Error ? e.message : String(e)).includes("429"),
  pocketRetryAfterMsFromError: (e: unknown) => {
    const v = (e as { retryAfterMs?: unknown } | null)?.retryAfterMs;
    return typeof v === "number" ? v : null;
  },
  markPocketApiRateLimited: () => {},
}));

vi.mock("@/lib/atpocket-write-with-import-key", () => ({
  writePocketRecordWithImportKey: async (opts: Record<string, unknown>) => {
    h.writeAttempts.push(opts);
    const err = h.writeErrors.shift();
    if (err) throw err;
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
const { invalidateAttendanceRosterCache, invalidateAttendanceStatusCache } =
  await import("@/lib/attendance-cache");

function todayJst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );
}

/** 本日の勤怠行（出勤済み・退勤まだ） */
function clockedInRow() {
  return {
    recordId: 500,
    record: {
      [STAFF]: "西村直也",
      [WORK_DATE]: todayJst(),
      [CLOCK_IN]: "09:00",
    },
  };
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.ATTENDANCE_APP_ID = "99";
  // 実時間で1秒待たせない（待ち時間そのものは別のテストで見る）
  process.env.ATTENDANCE_WRITE_RETRY_WAIT_MS = "0";
  h.todayRows = [];
  h.writeAttempts = [];
  h.writeErrors = [];
  invalidateAttendanceStatusCache();
  invalidateAttendanceRosterCache();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("429 のときだけ入れ直す", () => {
  it("★ 1回目が 429 でも、入れ直して成功すれば打刻できる", async () => {
    h.todayRows = [clockedInRow()];
    h.writeErrors = [pocket429()];

    const result = await punchAttendanceForLineUser("U-test", "out");

    expect(h.writeAttempts).toHaveLength(2);
    expect(result.ok).toBe(true);
  });

  it("★ 入れ直しは1回だけ（2回目も 429 なら諦める）", async () => {
    h.todayRows = [clockedInRow()];
    h.writeErrors = [pocket429(), pocket429()];

    const result = await punchAttendanceForLineUser("U-test", "out");

    // 混んでいるときに各自が何度も入れ直すと上限を食い合う
    expect(h.writeAttempts).toHaveLength(2);
    expect(result.ok).toBe(false);
  });

  it("★ 400（取込キー不備）は入れ直さない", async () => {
    h.todayRows = [clockedInRow()];
    h.writeErrors = [
      new Error("@pocket update record failed: 400 取込設定にキー項目が…"),
    ];

    const result = await punchAttendanceForLineUser("U-test", "out");

    // 入れ直しても結果が変わらず、書き込みを2回投げる危険だけが残る
    expect(h.writeAttempts).toHaveLength(1);
    expect(result.ok).toBe(false);
  });

  it("★ 403・500 も入れ直さない", async () => {
    for (const raw of [
      "@pocket update record failed: 403 Forbidden",
      "@pocket update record failed: 500 Internal Server Error",
    ]) {
      h.todayRows = [clockedInRow()];
      h.writeAttempts = [];
      h.writeErrors = [new Error(raw)];
      invalidateAttendanceStatusCache();
      invalidateAttendanceRosterCache();

      await punchAttendanceForLineUser("U-test", "out");

      expect(h.writeAttempts, raw).toHaveLength(1);
    }
  });

  it("出勤の新規作成でも同じように1回だけ入れ直す", async () => {
    h.todayRows = [];
    h.writeErrors = [pocket429()];

    const result = await punchAttendanceForLineUser("U-test", "in");

    expect(h.writeAttempts).toHaveLength(2);
    expect(result.ok).toBe(true);
  });
});

describe("画面に @pocket の生メッセージを出さない", () => {
  it("★ 429 は固定文言＋相関ID", async () => {
    h.todayRows = [clockedInRow()];
    h.writeErrors = [pocket429(), pocket429()];

    const result = await punchAttendanceForLineUser("U-test", "out");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(
      /^時間をおいてもう一度お試しください（ID: [0-9a-f]{8}）$/,
    );
  });

  it("★ それ以外は固定文言＋相関ID", async () => {
    h.todayRows = [clockedInRow()];
    h.writeErrors = [new Error("@pocket update record failed: 500 boom")];

    const result = await punchAttendanceForLineUser("U-test", "out");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(
      /^打刻に失敗しました。DX事業部へ連絡してください（ID: [0-9a-f]{8}）$/,
    );
  });

  it("★ appsId・環境変数名・operation が画面へ出ない", async () => {
    h.todayRows = [clockedInRow()];
    h.writeErrors = [pocket429(), pocket429()];

    const result = await punchAttendanceForLineUser("U-test", "out");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const leak of [
      "appsId",
      "apiKey",
      "ATTENDANCE_ATPOCKET_API_KEY_2",
      "operation",
      "@pocket",
      "429",
    ]) {
      expect(result.error, leak).not.toContain(leak);
    }
  });

  it("★ 生メッセージはサーバログに残る（相関IDで辿れる）", async () => {
    h.todayRows = [clockedInRow()];
    h.writeErrors = [new Error("@pocket update record failed: 500 boom")];

    const result = await punchAttendanceForLineUser("U-test", "out");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const id = result.error.match(/ID: ([0-9a-f]{8})/)?.[1];
    expect(id).toBeTruthy();

    const logged = errorSpy.mock.calls
      .map((c) => c.map((x) => String(x)).join(" "))
      .join("\n");
    expect(logged).toContain(`correlationId=${id}`);
    expect(logged).toContain("rateLimited=false");
    expect(logged).toContain("500 boom");
  });

  it("★ 429 のログは rateLimited=true で絞り込める", async () => {
    h.todayRows = [clockedInRow()];
    h.writeErrors = [pocket429(), pocket429()];

    await punchAttendanceForLineUser("U-test", "out");

    const logged = errorSpy.mock.calls
      .map((c) => c.map((x) => String(x)).join(" "))
      .join("\n");
    expect(logged).toContain("rateLimited=true");
    // 入れ直した事実も残す
    expect(
      warnSpy.mock.calls.map((c) => c.map((x) => String(x)).join(" ")).join("\n"),
    ).toContain("1回だけ入れ直します");
  });
});

describe("待ち時間", () => {
  it("★ Retry-After があればそれに従い、無ければ既定1秒", async () => {
    const { attendanceWriteRetryWaitMs } = await import(
      "@/lib/attendance-server"
    );

    delete process.env.ATTENDANCE_WRITE_RETRY_WAIT_MS;
    expect(attendanceWriteRetryWaitMs()).toBe(1_000);

    // 関数の実行時間を使い切らないよう上限で頭を打つ
    process.env.ATTENDANCE_WRITE_RETRY_WAIT_MS = "60000";
    expect(attendanceWriteRetryWaitMs()).toBe(5_000);

    process.env.ATTENDANCE_WRITE_RETRY_WAIT_MS = "0";
    expect(attendanceWriteRetryWaitMs()).toBe(0);
  });
});
