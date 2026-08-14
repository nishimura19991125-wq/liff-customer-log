import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * キャッシュを共有しても、担当者ごとの絞り込みが従来どおり効くこと（Phase 0 §6）。
 *
 * 絞り込みは recordMatchesStaff（変更していない）で、キャッシュから
 * 取り出した**後**に走る。ここでは
 *   - 別々の担当者で呼んでも @pocket は1回だけ
 *   - それぞれ自分の分だけが返る
 * を同時に確認する。
 */

const h = vi.hoisted(() => ({
  fetchCalls: 0,
  records: [] as Array<{ record: Record<string, unknown>; id?: string }>,
}));

const APO_FIELDS = [
  { uniqueId: "field-10", caption: "CL担当者" },
  { uniqueId: "field-11", caption: "商談・資料送付予定日時" },
  { uniqueId: "field-12", caption: "お客様名" },
];

vi.mock("@/lib/sales-dashboard-list-fetch", () => ({
  fetchSalesDashboardRecordPages: async () => {
    h.fetchCalls++;
    return h.records;
  },
  salesDashboardApoListAuths: () => [{ apiKey: "dummy" }],
}));

vi.mock("@/lib/atpocket", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/atpocket")>();
  return {
    ...actual,
    fetchAppFields: async () => APO_FIELDS,
    apiKeyForSalesDashboardApoPocket: () => "dummy",
    apiKeyForSalesDashboardApoWrite: () => "dummy",
  };
});

vi.mock("@/lib/sales-dashboard-fields", () => ({
  salesDashboardApoAppId: () => "18",
}));

const { buildMeetingScheduleListForStaff } = await import(
  "@/lib/meeting-schedule"
);
const { invalidateMeetingScheduleRecordsCache } = await import(
  "@/lib/meeting-schedule-records-cache"
);

/** @pocket のレコード行を作る（CL担当者・商談日・お客様名） */
function row(id: string, clPerson: string, name: string) {
  return {
    id,
    record: {
      "field-10": clPerson,
      "field-11": "2026-08-20",
      "field-12": name,
    },
  };
}

beforeEach(() => {
  h.fetchCalls = 0;
  h.records = [
    row("1", "山田太郎", "顧客A"),
    row("2", "鈴木一郎", "顧客B"),
    row("3", "山田太郎", "顧客C"),
  ];
  invalidateMeetingScheduleRecordsCache();
  delete process.env.MEETING_SCHEDULE_CACHE_SECONDS;
  delete process.env.MEETING_SCHEDULE_CL_PERSON_FIELD_ID;
  delete process.env.MEETING_SCHEDULE_MEETING_DATE_FIELD_ID;
});

describe("キャッシュ共有と担当者絞り込みの両立", () => {
  it("★ 別々の担当者で呼んでも @pocket へは1回だけ", async () => {
    await buildMeetingScheduleListForStaff("山田太郎");
    await buildMeetingScheduleListForStaff("鈴木一郎");
    await buildMeetingScheduleListForStaff("山田太郎");

    expect(h.fetchCalls).toBe(1);
  });

  it("★ 担当者ごとに自分の分だけが返る", async () => {
    const yamada = await buildMeetingScheduleListForStaff("山田太郎");
    const suzuki = await buildMeetingScheduleListForStaff("鈴木一郎");

    expect(yamada.configured).toBe(true);
    expect(yamada.items.map((i) => i.customerName).sort()).toEqual([
      "顧客A",
      "顧客C",
    ]);
    expect(suzuki.items.map((i) => i.customerName)).toEqual(["顧客B"]);
  });

  it("担当外の人には何も返さない（403 相当の絞り込みが効いている）", async () => {
    const other = await buildMeetingScheduleListForStaff("無関係な人");
    expect(other.items).toEqual([]);
  });

  it("staffName は呼び出した本人の名前がそのまま入る", async () => {
    const payload = await buildMeetingScheduleListForStaff("鈴木一郎");
    expect(payload.staffName).toBe("鈴木一郎");
  });

  it("全角半角・空白のゆれは従来どおり同一人物として扱う", async () => {
    h.records = [row("1", "山田 太郎", "顧客A")];
    invalidateMeetingScheduleRecordsCache();

    const payload = await buildMeetingScheduleListForStaff("山田　太郎");
    expect(payload.items.map((i) => i.customerName)).toEqual(["顧客A"]);
  });
});
