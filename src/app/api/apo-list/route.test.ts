import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * アポ情報一覧。
 *
 * 見どころは2つ。
 *  1. 商談進捗と**同じ fieldsCsv** で取りに行くこと（キャッシュキーが一致し、
 *     @pocket へのリクエストが増えない＝429 の再発を防ぐ）
 *  2. 見積ステータスで絞り込まないこと（「すべて」が真の全件になる）
 */

const h = vi.hoisted(() => ({
  /** fetchMeetingScheduleRecordsCached に渡された fieldsCsv を記録する */
  requestedCsv: [] as string[],
  records: [] as Array<Record<string, unknown>>,
  /** ギフト券の列。null は「@pocket に列が見つからない」場合 */
  giftCouponFieldId: "f_gift" as string | null,
}));

const FIELD = {
  clPerson: "f_cl",
  salesperson: "f_ap",
  scheduledDate: "f_scheduled",
  customerName: "f_name",
  city: "f_city",
  meetingTime: "f_time",
  estimateStatus: "f_status",
  apoType: "f_apo_type",
  meetingPlace: "f_place",
  meetingDate: "f_meeting_date",
  closeType: "f_close_type",
  responseDate: "f_response_date",
  negotiationStatus: "f_nego",
};

/** ギフト券の列ID（テスト用の固定値） */
const FIELD_GIFT = "f_gift";

/** 列が見つからない場合を再現できるよう、ギフト券だけ差し替え可能にする */
function fieldMap() {
  return { ...FIELD, giftCoupon: h.giftCouponFieldId };
}

vi.mock("@/lib/request-auth", () => ({
  resolveCallerLineAuth: async () => ({ ok: true, lineUserId: "U-test" }),
  lineAuthUnauthorizedResponse: () => new Response(null, { status: 401 }),
}));

vi.mock("@/lib/customer-info-config", () => ({
  customerInfoConfigReady: () => ({ ok: true, appId: "35" }),
}));

vi.mock("@/lib/staff-bound-lookup", () => ({
  resolveBoundStaffNameForLineUser: async () => "西村太郎",
}));

vi.mock("@/lib/atpocket", () => ({
  apiKeyForSalesDashboardApoPocket: () => "dummy",
  apiKeyForSalesDashboardApoWrite: () => "dummy",
  salesDashboardApoWriteConfigured: () => true,
  fetchAppFields: async () => [],
  fetchRecordById: async () => null,
  updateRecord: async () => {},
}));

vi.mock("@/lib/meeting-schedule-fields", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/meeting-schedule-fields")>();
  return { ...actual, resolveMeetingScheduleFieldMap: () => fieldMap() };
});

vi.mock("@/lib/meeting-schedule-records-cache", () => ({
  fetchMeetingScheduleRecordsCached: async (
    _appId: string,
    fieldsCsv: string,
  ) => {
    h.requestedCsv.push(fieldsCsv);
    return h.records.map((record, i) => ({ recordId: String(i + 1), record }));
  },
  invalidateMeetingScheduleRecordsCache: () => {},
}));

vi.mock("@/lib/sales-dashboard-fields", () => ({
  salesDashboardApoAppId: () => "40",
}));

vi.mock("@/lib/sales-dashboard-list-fetch", () => ({
  salesDashboardApoListAuths: () => [{ apiKey: "dummy" }],
  fetchSalesDashboardRecordPages: async () => [],
}));

import { GET as apoListGet } from "@/app/api/apo-list/route";
import { GET as meetingScheduleGet } from "@/app/api/meeting-schedule/route";
import type { ApoListPayload } from "@/lib/apo-list-types";

function record(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [FIELD.clPerson]: "西村太郎",
    [FIELD.salesperson]: "西村太郎",
    [FIELD.customerName]: "テスト様",
    [FIELD.city]: "奈良県生駒市さつき台1-1",
    [FIELD.meetingTime]: "14:00",
    [FIELD.scheduledDate]: "2026-09-05 14:00:00",
    [FIELD.estimateStatus]: "見積依頼済み",
    [FIELD.negotiationStatus]: "商談待ち",
    ...over,
  };
}

function get(path: string): Request {
  return new Request(`http://localhost${path}`);
}

beforeEach(() => {
  h.requestedCsv.length = 0;
  h.records = [];
  h.giftCouponFieldId = "f_gift";
});

describe("GET /api/apo-list", () => {
  it("★★ 商談進捗と同じ fieldsCsv で取りに行く（キャッシュキーが一致する）", async () => {
    h.records = [record()];

    await apoListGet(get("/api/apo-list"));
    await meetingScheduleGet(get("/api/meeting-schedule?scope=list"));

    expect(h.requestedCsv).toHaveLength(2);
    // ここがずれるとキャッシュが割れ、@pocket へのリクエストが倍になる
    expect(h.requestedCsv[0]).toBe(h.requestedCsv[1]);
    expect(h.requestedCsv[0]).not.toBe("");
  });

  it("表示に要る4項目を返す", async () => {
    h.records = [record()];

    const res = await apoListGet(get("/api/apo-list"));
    const body = (await res.json()) as ApoListPayload;

    expect(body.configured).toBe(true);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({
      scheduledTime: "14:00",
      customerName: "テスト様",
      // 市区郡は市区町村郡までを抽出する
      city: "奈良県生駒市",
      estimateStatus: "見積依頼済み",
      negotiationStatus: "商談待ち",
    });
  });

  it("★ 見積ステータスで絞り込まない（「すべて」が真の全件になる）", async () => {
    // 「成約」は MEETING_SCHEDULE_STATUSES の対象外。
    // 商談進捗の一覧では落ちるが、こちらでは落とさない
    h.records = [
      record({ [FIELD.estimateStatus]: "成約" }),
      record({ [FIELD.estimateStatus]: "再商談否" }),
      record({ [FIELD.estimateStatus]: "見積依頼済み" }),
    ];

    const res = await apoListGet(get("/api/apo-list"));
    const body = (await res.json()) as ApoListPayload;

    expect(body.rows).toHaveLength(3);
    expect(body.rows.map((r) => r.estimateStatus).sort()).toEqual(
      ["再商談否", "成約", "見積依頼済み"].sort(),
    );
  });

  it("★ 自分の担当以外は返さない", async () => {
    h.records = [
      record({ [FIELD.clPerson]: "別人", [FIELD.salesperson]: "別人" }),
      record({ [FIELD.clPerson]: "西村太郎", [FIELD.salesperson]: "別人" }),
      record({ [FIELD.clPerson]: "別人", [FIELD.salesperson]: "西村太郎" }),
    ];

    const res = await apoListGet(get("/api/apo-list"));
    const body = (await res.json()) as ApoListPayload;

    // CL か AP のどちらかが一致すれば対象（recordMatchesStaff と同じ判定）
    expect(body.rows).toHaveLength(2);
  });

  it("★ 0件でも壊れない", async () => {
    h.records = [];

    const res = await apoListGet(get("/api/apo-list"));
    const body = (await res.json()) as ApoListPayload;

    expect(res.status).toBe(200);
    expect(body.configured).toBe(true);
    expect(body.rows).toEqual([]);
  });

  it("時刻が無い案件も落とさず、後ろに並べる", async () => {
    h.records = [
      record({ [FIELD.meetingTime]: "", [FIELD.scheduledDate]: "", [FIELD.customerName]: "時刻なし" }),
      record({ [FIELD.meetingTime]: "09:00", [FIELD.customerName]: "朝" }),
    ];

    const res = await apoListGet(get("/api/apo-list"));
    const body = (await res.json()) as ApoListPayload;

    expect(body.rows.map((r) => r.customerName)).toEqual(["朝", "時刻なし"]);
    expect(body.rows[1]?.scheduledTime).toBe("");
  });
});

describe("GET /api/apo-list（表示項目）", () => {
  it("★ アポ種別が取れる（既存 CSV に含まれている列）", async () => {
    h.records = [record({ [FIELD.apoType]: "ダイレクト" })];

    const res = await apoListGet(get("/api/apo-list"));
    const body = (await res.json()) as ApoListPayload;

    // apoTypeDisplayLabel が「ダイレクト」→「DC案件」に整形する
    expect(body.rows[0]?.apoTypeLabel).toBe("DC案件");
  });

  it("★ 商談・資料送付予定日時の日付を持つ（初回商談実施日で埋めない）", async () => {
    h.records = [
      record({
        [FIELD.scheduledDate]: "2026-09-05 14:00:00",
        [FIELD.meetingDate]: "2026-01-05",
      }),
    ];

    const res = await apoListGet(get("/api/apo-list"));
    const body = (await res.json()) as ApoListPayload;

    expect(body.rows[0]?.scheduledYmd).toBe("2026-09-05");
    expect(body.rows[0]?.scheduledTime).toBe("14:00");
  });

  it("★ 予定日時が空なら、初回商談実施日があっても日付は空", async () => {
    h.records = [
      record({
        [FIELD.scheduledDate]: "",
        [FIELD.meetingTime]: "",
        [FIELD.meetingDate]: "2026-01-05",
      }),
    ];

    const res = await apoListGet(get("/api/apo-list"));
    const body = (await res.json()) as ApoListPayload;

    expect(body.rows[0]?.scheduledYmd).toBe("");
    expect(body.rows[0]?.scheduledDateLabel).toBe("日付未定");
  });

  it("日付見出しの文言が付く", async () => {
    h.records = [record({ [FIELD.scheduledDate]: "2026-06-12 14:00:00" })];

    const res = await apoListGet(get("/api/apo-list"));
    const body = (await res.json()) as ApoListPayload;

    expect(body.rows[0]?.scheduledDateLabel).toBe("6月12日（金）");
  });

  it("★ 日付・時刻の昇順で返す（日付未定は末尾）", async () => {
    // 時刻は「時刻」列が優先されるため、そちらも合わせて指定する
    h.records = [
      record({
        [FIELD.scheduledDate]: "",
        [FIELD.meetingTime]: "",
        [FIELD.customerName]: "未定",
      }),
      record({
        [FIELD.scheduledDate]: "2026-06-13 09:00:00",
        [FIELD.meetingTime]: "09:00",
        [FIELD.customerName]: "翌日",
      }),
      record({
        [FIELD.scheduledDate]: "2026-06-12 15:00:00",
        [FIELD.meetingTime]: "15:00",
        [FIELD.customerName]: "当日午後",
      }),
      record({
        [FIELD.scheduledDate]: "2026-06-12 09:00:00",
        [FIELD.meetingTime]: "09:00",
        [FIELD.customerName]: "当日午前",
      }),
    ];

    const res = await apoListGet(get("/api/apo-list"));
    const body = (await res.json()) as ApoListPayload;

    expect(body.rows.map((r) => r.customerName)).toEqual([
      "当日午前",
      "当日午後",
      "翌日",
      "未定",
    ]);
  });
});

/**
 * ギフト券の列を CSV に足したので、全経路が同じ CSV を使い続けることを
 * ここで固定する。ずれるとキャッシュが割れて @pocket へのリクエストが
 * 倍になり、429 が再発する
 */
describe("ギフト券の列とキャッシュキー", () => {
  it("★★ 列を足しても、商談進捗と同じ fieldsCsv のまま", async () => {
    await apoListGet(get("/api/apo-list"));
    await meetingScheduleGet(get("/api/meeting-schedule?scope=list"));

    expect(h.requestedCsv).toHaveLength(2);
    expect(h.requestedCsv[0]).toBe(h.requestedCsv[1]);
    // 足した列が実際に要求されている
    expect(h.requestedCsv[0]).toContain("f_gift");
  });

  it("★★ 列が見つからないときは CSV に増えない（キャッシュキーが変わらない）", async () => {
    h.giftCouponFieldId = null;

    await apoListGet(get("/api/apo-list"));
    await meetingScheduleGet(get("/api/meeting-schedule?scope=list"));

    // 両経路とも同じで、ギフト券の分は入らない
    expect(h.requestedCsv[0]).toBe(h.requestedCsv[1]);
    expect(h.requestedCsv[0]).not.toContain("f_gift");
    // 空文字や undefined が紛れ込まない
    expect(h.requestedCsv[0]?.split(",").every(Boolean)).toBe(true);
  });

  it("列の有無で CSV は変わる（＝足した列が効いている）", async () => {
    await apoListGet(get("/api/apo-list"));
    h.giftCouponFieldId = null;
    await apoListGet(get("/api/apo-list"));

    expect(h.requestedCsv[0]).not.toBe(h.requestedCsv[1]);
  });

  it("ギフト券の値を行に持たせる", async () => {
    h.records = [record({ [FIELD_GIFT]: "有" })];

    const res = await apoListGet(get("/api/apo-list"));
    const body = (await res.json()) as ApoListPayload;

    expect(body.rows[0]?.giftCoupon).toBe("有");
  });

  it("列が見つからないときは空になる（バッジは出ない）", async () => {
    h.giftCouponFieldId = null;
    h.records = [record({ [FIELD_GIFT]: "有" })];

    const res = await apoListGet(get("/api/apo-list"));
    const body = (await res.json()) as ApoListPayload;

    expect(body.rows[0]?.giftCoupon).toBe("");
  });
});
