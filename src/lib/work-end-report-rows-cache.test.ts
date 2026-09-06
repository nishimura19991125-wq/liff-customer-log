import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 稼働終了報告の一覧取得を減らす（出勤打刻の時間帯の @pocket 429 対策・段階1）。
 *
 * @pocket の上限は **100秒あたり100回・サイト単位**。キーを増やしても
 * 増えないので、減らせるのは呼び出しの総量だけ。この一覧は打刻画面を
 * 開くたびに取られており、次の2つで効いていた。
 *
 *   1. 1ページ 1000 件返るのに `< 100` で打ち切り判定していた
 *      → 100 件を超えた時点から**毎回必ず2ページ目**まで取っていた
 *   2. 中身は誰が見ても同じなのに、利用者ごとに取り直していた
 *
 * ここで固定するのは「取得回数」そのもの。件数や本文ではなく、
 * @pocket を何回叩いたかを数える。
 */

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

const h = vi.hoisted(() => ({
  /** fetchRecordsList の呼び出し（limit / page） */
  listCalls: [] as Array<{ limit?: string; page?: string }>,
  /** 1ページ目に返す件数 */
  page1Count: 0,
  /** 1ページ目の先頭に足す行（本日ぶんの報告を後から生やす用） */
  extraRows: [] as Array<{ recordId: number; record: Record<string, unknown> }>,
  /** @pocket へ書き込んだ報告 */
  created: [] as Array<Record<string, unknown>>,
  /** 書き込みが通ったときに走らせる副作用（一覧に本日ぶんを生やす） */
  onCreate: null as null | (() => void),
}));

function rows(count: number) {
  return [
    ...h.extraRows,
    ...Array.from({ length: count }, (_, i) => ({
      recordId: i + 1000,
      record: { [REPORTER]: `他の人${i}`, [REPORT_DATE]: "2000-01-01" },
    })),
  ];
}

vi.mock("@/lib/atpocket", () => ({
  apiKeyForWorkEndReportPocket: () => "read",
  apiKeyForWorkEndReportPocket1: () => "read1",
  apiKeyForWorkEndReportWrite: () => "write",
  fetchAppFields: async () => APP_FIELDS,
  fetchRecordsList: async (
    _appId: string,
    params: { limit?: string; page?: string },
  ) => {
    h.listCalls.push({ limit: params.limit, page: params.page });
    // 2ページ目以降は空（1ページ目で打ち切れれば呼ばれない）
    return { records: params.page === "1" ? rows(h.page1Count) : [] };
  },
  fetchAllRecordsPages: async () => [],
  createRecord: async (_appId: string, payload: Record<string, unknown>) => {
    h.created.push(payload);
    h.onCreate?.();
    return { row: { recordId: 1 }, recordIdHint: "1" };
  },
  isPocketApiRateLimited: () => false,
  isPocketHttpRateLimitError: () => false,
  markPocketApiRateLimited: () => {},
}));

vi.mock("@/lib/staff-bound-lookup", () => ({
  resolveBoundStaffNameForLineUser: async (lineUserId: string) =>
    `担当者${lineUserId}`,
}));

vi.mock("@/lib/staff-department-lookup", () => ({
  lookupStaffDepartmentByStaffName: async () => "DX事業部",
}));

vi.mock("@/lib/attendance-server", () => ({
  punchAttendanceForLineUser: async () => ({ ok: true, status: {} }),
}));

const { getWorkEndReportStatusForLineUser, submitWorkEndReportForLineUser } =
  await import("@/lib/work-end-report-server");
const { invalidateWorkEndReportRowsCache } = await import(
  "@/lib/work-end-report-cache"
);

beforeEach(() => {
  invalidateWorkEndReportRowsCache();
  process.env.WORK_END_REPORT_APP_ID = "88";
  delete process.env.WORK_END_REPORT_ROWS_CACHE_TTL_MS;
  h.listCalls = [];
  h.page1Count = 0;
  h.extraRows = [];
  h.created = [];
  h.onCreate = null;
});

/** JST の本日（サーバ側と同じ求め方） */
function todayJst(): string {
  const d = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }),
  );
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

const FORM = {
  pinponCount: "10",
  meetingCount: "3",
  apoCount: "1",
  apoActivity: "実施",
  workArea: "奈良市",
};

describe("打ち切り判定と取得件数をそろえる", () => {
  it("★ 100件を超えても2ページ目を取りに行かない（1000件そろえたので1回で済む）", async () => {
    h.page1Count = 150;

    await getWorkEndReportStatusForLineUser("U1");

    // 直す前は limit 未指定（=1000件返る）で `< 100` 判定のため必ず2回だった
    expect(h.listCalls).toHaveLength(1);
    expect(h.listCalls[0]).toEqual({ limit: "1000", page: "1" });
  });

  it("★ 1ページに収まりきらないときだけ次のページへ進む", async () => {
    h.page1Count = 1000;

    await getWorkEndReportStatusForLineUser("U1");

    expect(h.listCalls.map((c) => c.page)).toEqual(["1", "2"]);
  });
});

describe("全員で共有するキャッシュ", () => {
  it("★ 2人目以降は @pocket を叩かない（キーに利用者を含めない）", async () => {
    h.page1Count = 3;

    await getWorkEndReportStatusForLineUser("U1");
    await getWorkEndReportStatusForLineUser("U2");
    await getWorkEndReportStatusForLineUser("U3");

    // 利用者ごとのキーにすると、ここが 3 になる
    expect(h.listCalls).toHaveLength(1);
  });

  it("★ 同時に開かれても @pocket へは1本だけ出す（inflight）", async () => {
    h.page1Count = 3;

    await Promise.all([
      getWorkEndReportStatusForLineUser("U1"),
      getWorkEndReportStatusForLineUser("U2"),
      getWorkEndReportStatusForLineUser("U3"),
    ]);

    expect(h.listCalls).toHaveLength(1);
  });

  it("TTL に 0 を渡せばキャッシュしない（切り分け用）", async () => {
    process.env.WORK_END_REPORT_ROWS_CACHE_TTL_MS = "0";
    h.page1Count = 3;

    await getWorkEndReportStatusForLineUser("U1");
    await getWorkEndReportStatusForLineUser("U2");

    expect(h.listCalls).toHaveLength(2);
  });
});

describe("キャッシュの寿命", () => {
  it("★ TTL は既定 60 秒で、延ばす方向には動かせない", async () => {
    const { workEndReportRowsCacheTtlMs } = await import(
      "@/lib/work-end-report-cache"
    );

    delete process.env.WORK_END_REPORT_ROWS_CACHE_TTL_MS;
    expect(workEndReportRowsCacheTtlMs()).toBe(60_000);

    process.env.WORK_END_REPORT_ROWS_CACHE_TTL_MS = "600000";
    // 提出したのに未提出のまま見える時間が伸びるので、上限で止める
    expect(workEndReportRowsCacheTtlMs()).toBe(60_000);

    process.env.WORK_END_REPORT_ROWS_CACHE_TTL_MS = "5000";
    expect(workEndReportRowsCacheTtlMs()).toBe(5_000);
  });

  it("★ キャッシュキーに利用者が入っていない", async () => {
    const { workEndReportRowsCacheKey } = await import(
      "@/lib/work-end-report-cache"
    );

    expect(workEndReportRowsCacheKey("88", "f1,f2")).toBe(
      workEndReportRowsCacheKey("88", "f1,f2"),
    );
    // 列構成が変われば別物として取り直す
    expect(workEndReportRowsCacheKey("88", "f1,f2")).not.toBe(
      workEndReportRowsCacheKey("88", "f1,f2,f3"),
    );
  });
});

/**
 * キャッシュを足したせいで壊してはいけないもの。
 *
 * 一覧は「本日すでに報告したか」の判定にも使う。ここが古いままだと、
 * 同じ日の報告が2件できる／提出した本人に「未提出」と見え続ける。
 */
describe("提出まわりで古い一覧を使わない", () => {
  it("★ 二重提出の判定はキャッシュを使わず取り直す", async () => {
    h.page1Count = 3;
    // 画面表示でキャッシュを温めておく
    await getWorkEndReportStatusForLineUser("U1");
    expect(h.listCalls).toHaveLength(1);

    // その後に本人の本日ぶんが入った（別端末・別経路からの提出）
    h.extraRows = [
      {
        recordId: 1,
        record: { [REPORTER]: "担当者U1", [REPORT_DATE]: todayJst() },
      },
    ];

    const result = await submitWorkEndReportForLineUser("U1", FORM);

    // 温まったキャッシュを見ていたら 409 にならず、報告が2件できる
    expect(h.listCalls).toHaveLength(2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect(h.created).toHaveLength(0);
  });

  it("★ 書き込んだらキャッシュを捨てる（提出後に未提出のまま見えない）", async () => {
    h.page1Count = 3;
    // 画面表示で「まだ報告していない」一覧を温めておく
    const before = await getWorkEndReportStatusForLineUser("U1");
    expect(before.canReport).toBe(true);

    // 書き込みが通れば、以降の一覧には本日ぶんが載る
    h.onCreate = () => {
      h.extraRows = [
        {
          recordId: 1,
          record: { [REPORTER]: "担当者U1", [REPORT_DATE]: todayJst() },
        },
      ];
    };

    await submitWorkEndReportForLineUser("U1", FORM);
    expect(h.created).toHaveLength(1);

    const after = await getWorkEndReportStatusForLineUser("U1");

    // 捨てていなければ書き込み前の一覧が残り、また提出できるように見える
    expect(after.canReport).toBe(false);
    expect(after.reportedAt).toBe(todayJst());
  });
});
