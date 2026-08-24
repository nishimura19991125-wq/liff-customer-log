import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 見積ステータス・商談・資料送付予定日時を LIFF から書き込めなくする。
 *
 * 画面から入力欄を消しても、古いキャッシュの画面や API の直叩きで
 * 書き込めてしまうため、@pocket へ実際に飛ぶ payload の中身で見る。
 * 同時に「同じルートに同居している付随項目は巻き込まれない」ことも見る。
 */

const h = vi.hoisted(() => ({
  updateCalls: [] as Array<Record<string, unknown>>,
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

const IMPORT_KEY_FIELD_ID = "f_apo_no";

/** 担当者が一致し、現在ステータスは「商談セット作成済み」 */
const RECORD = {
  [FIELD.clPerson]: "西村太郎",
  [FIELD.salesperson]: "西村太郎",
  [FIELD.estimateStatus]: "商談セット作成済み",
  [FIELD.meetingDate]: "2026-09-10",
  [FIELD.closeType]: "両クロ",
  [FIELD.meetingPlace]: "自宅",
  [FIELD.scheduledDate]: "2026-09-05 10:00:00",
  [IMPORT_KEY_FIELD_ID]: "APO-001",
};

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
  fetchRecordById: async () => ({ record: RECORD }),
  updateRecord: async (
    _appId: string,
    _recordId: string,
    payload: Record<string, unknown>,
  ) => {
    h.updateCalls.push(payload);
  },
}));

vi.mock("@/lib/meeting-schedule-fields", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/meeting-schedule-fields")>();
  return {
    ...actual,
    resolveMeetingScheduleFieldMap: () => FIELD,
    resolveMeetingScheduleImportKeyFieldId: () => IMPORT_KEY_FIELD_ID,
  };
});

vi.mock("@/lib/meeting-schedule-records-cache", () => ({
  fetchMeetingScheduleRecordsCached: async () => [],
  invalidateMeetingScheduleRecordsCache: () => {},
}));

vi.mock("@/lib/sales-dashboard-fields", () => ({
  salesDashboardApoAppId: () => "40",
}));

vi.mock("@/lib/sales-dashboard-list-fetch", () => ({
  salesDashboardApoListAuths: () => [{ apiKey: "dummy" }],
}));

import { PATCH as statusPatch } from "@/app/api/meeting-schedule/records/[recordId]/status/route";
import { PATCH as schedulePatch } from "@/app/api/meeting-schedule/records/[recordId]/schedule/route";

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ recordId: "123" }) };

beforeEach(() => {
  h.updateCalls.length = 0;
});

describe("PATCH .../status（見積ステータスは payload から落とす）", () => {
  it("★ 見積ステータスの列は @pocket へ送らない（誤タップの再現）", async () => {
    // 現在「商談セット作成済み」の案件を「返待ち」に変えようとする
    const res = await statusPatch(
      patchRequest({ status: "返待ち", responseDate: "2026-09-20" }),
      ctx,
    );

    expect(res.status).toBe(200);
    // 返待ち回答日は書かれるが、見積ステータスの列はどの PUT にも現れない
    expect(h.updateCalls).toHaveLength(1);
    expect(
      h.updateCalls.some((p) =>
        Object.prototype.hasOwnProperty.call(p, FIELD.estimateStatus),
      ),
    ).toBe(false);
  });

  it("★ 付随項目は従来どおり書き込まれる（他項目を巻き込まない）", async () => {
    await statusPatch(
      patchRequest({
        status: "商談セット作成済み",
        meetingDate: "2026-09-11",
        closeType: "片クロ",
        meetingPlace: "店舗",
      }),
      ctx,
    );

    expect(h.updateCalls[0]).toEqual({
      [IMPORT_KEY_FIELD_ID]: "APO-001",
      [FIELD.meetingDate]: "2026-09-11",
      [FIELD.closeType]: "片クロ",
      [FIELD.meetingPlace]: "店舗",
    });
  });

  it("返待ち回答日も従来どおり書き込まれる", async () => {
    await statusPatch(
      patchRequest({ status: "返待ち", responseDate: "2026-09-20" }),
      ctx,
    );

    expect(h.updateCalls[0]).toEqual({
      [IMPORT_KEY_FIELD_ID]: "APO-001",
      [FIELD.responseDate]: "2026-09-20",
    });
  });

  it("ステータスだけ送られたら書くものが無いので PUT しない", async () => {
    const res = await statusPatch(patchRequest({ status: "即決成約" }), ctx);

    expect(res.status).toBe(200);
    expect(h.updateCalls).toHaveLength(0);
    // 書き換えていないので、レコードの現在値をそのまま返す
    await expect(res.json()).resolves.toMatchObject({
      estimateStatus: "商談セット作成済み",
    });
  });

  it("変更できないステータスを申告されても 400 で止めない", async () => {
    // 見積ステータスを書き込まなくなった以上、「変更できないステータスです」の
    // 門番は意味が無い。ここで 400 を返すと、同じルートに同居している
    // 付随項目の保存まで巻き込んで止めてしまう
    const res = await statusPatch(
      patchRequest({ status: "存在しないステータス" }),
      ctx,
    );

    expect(res.status).toBe(200);
  });
});

describe("PATCH .../schedule（日時は 403 で拒否）", () => {
  it("★ 日時の書き込みは受け付けず、@pocket へ何も送らない", async () => {
    const res = await schedulePatch(
      patchRequest({ scheduledYmd: "2026-09-30", scheduledTime: "14:30" }),
      ctx,
    );

    expect(res.status).toBe(403);
    expect(h.updateCalls).toHaveLength(0);
    await expect(res.json()).resolves.toMatchObject({
      error:
        "商談・資料送付予定日時は LIFF から変更できません。@pocket 側で変更してください",
    });
  });

  it("日時の更新に伴う見積ステータスの自動リセットも起きない", async () => {
    // 現在ステータスが「商談セット作成済み」＋予定日変更＝自動リセットの条件
    await schedulePatch(patchRequest({ scheduledYmd: "2026-09-30" }), ctx);

    expect(h.updateCalls).toHaveLength(0);
  });
});
