import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * アポ情報の詳細（1件）。
 *
 * 見どころ:
 *  1. 既存 CSV（meetingScheduleWantedFieldCsv）を触らないこと。
 *     詳細は専用の CSV で recordId 指定の1件取得を行う
 *  2. 担当外の案件が見えないこと
 *  3. 希望メーカーの値を加工せずそのまま返すこと
 */

const h = vi.hoisted(() => ({
  detailCsv: [] as string[],
  listCsv: [] as string[],
  record: null as Record<string, unknown> | null,
  desiredManufacturerFound: true,
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
  giftCoupon: "f_gift",
};

/** 詳細で使う列。見出しで引ける形にしておく */
const DETAIL_FIELDS = [
  { uniqueId: "f_ap", caption: "AP担当者" },
  { uniqueId: "f_cl", caption: "CL担当者" },
  { uniqueId: "f_rank", caption: "アポランク" },
  { uniqueId: "f_contact", caption: "お客様連絡先" },
  { uniqueId: "f_pin", caption: "ピンポイント住所" },
  { uniqueId: "f_family", caption: "家族構成" },
  { uniqueId: "f_feature", caption: "ご家族の特徴" },
  { uniqueId: "f_talk", caption: "会話した内容" },
  { uniqueId: "f_est_type", caption: "見積種別" },
  { uniqueId: "f_shared", caption: "その他共有事項" },
];

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
  // 希望メーカーは見出しでは引かず field-61 で解決する
  fetchAppFields: async () => [
    ...DETAIL_FIELDS,
    ...(h.desiredManufacturerFound
      ? [{ uniqueId: "field-61", caption: "" }]
      : []),
  ],
  fetchRecordById: async (
    _appId: string,
    _recordId: string,
    _auth: unknown,
    fieldsCsv?: string,
  ) => {
    h.detailCsv.push(fieldsCsv ?? "");
    return h.record ? { recordId: "123", record: h.record } : null;
  },
  updateRecord: async () => {},
}));

vi.mock("@/lib/meeting-schedule-fields", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/meeting-schedule-fields")>();
  return { ...actual, resolveMeetingScheduleFieldMap: () => FIELD };
});

vi.mock("@/lib/meeting-schedule-records-cache", () => ({
  fetchMeetingScheduleRecordsCached: async (
    _appId: string,
    fieldsCsv: string,
  ) => {
    h.listCsv.push(fieldsCsv);
    return [];
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

import { GET as detailGet } from "@/app/api/apo-list/[recordId]/route";
import { GET as listGet } from "@/app/api/apo-list/route";
import { invalidateApoDetailCache } from "@/lib/apo-detail-cache";
import type { ApoDetailPayload } from "@/lib/apo-detail-types";

function fullRecord(over: Record<string, unknown> = {}) {
  return {
    [FIELD.clPerson]: "西村太郎",
    [FIELD.salesperson]: "西村太郎",
    [FIELD.customerName]: "テスト　太郎",
    f_rank: "A",
    f_contact: "090-0000-0000",
    f_pin: "https://maps.example.test/xyz",
    f_family: "4人",
    f_feature: "犬を飼っている",
    f_talk: "初回訪問\n次回は来週",
    f_est_type: "通常",
    "field-61": "SHARP,XSOL,Panasonic",
    f_shared: "特になし",
    ...over,
  };
}

function get(path: string): Request {
  return new Request("http://localhost" + path);
}

const ctx = (recordId: string) => ({
  params: Promise.resolve({ recordId }),
});

beforeEach(() => {
  h.detailCsv.length = 0;
  h.listCsv.length = 0;
  h.desiredManufacturerFound = true;
  h.record = fullRecord();
  invalidateApoDetailCache();
});

describe("GET /api/apo-list/[recordId]", () => {
  it("★ 11項目を指定の順序・グループで返す", async () => {
    const res = await detailGet(get("/api/apo-list/123"), ctx("123"));
    const body = (await res.json()) as ApoDetailPayload;

    expect(body.groups.map((g) => g.title)).toEqual([
      "アポ情報",
      "お客様情報",
      "見積",
    ]);
    expect(body.groups.flatMap((g) => g.items.map((i) => i.label))).toEqual([
      "AP担当者",
      "CL担当者",
      "アポランク",
      "お客様連絡先",
      "ピンポイント住所",
      "家族構成",
      "ご家族の特徴",
      "会話した内容",
      "見積種別",
      "希望メーカー",
      "その他共有事項",
    ]);
  });

  it("★ お客様名を見出し用に返す", async () => {
    const res = await detailGet(get("/api/apo-list/123"), ctx("123"));
    const body = (await res.json()) as ApoDetailPayload;
    expect(body.customerName).toBe("テスト　太郎");
  });

  it("★ 希望メーカーは加工せずそのまま返す", async () => {
    const res = await detailGet(get("/api/apo-list/123"), ctx("123"));
    const body = (await res.json()) as ApoDetailPayload;

    const value = body.groups
      .flatMap((g) => g.items)
      .find((i) => i.label === "希望メーカー")?.value;

    // 区切りの変換・スペース追加・並べ替えを一切しない
    expect(value).toBe("SHARP,XSOL,Panasonic");
  });

  it("★ 空欄の項目も行が残る（値は空文字）", async () => {
    h.record = fullRecord({ f_rank: "", f_shared: "", "field-61": "" });

    const res = await detailGet(get("/api/apo-list/123"), ctx("123"));
    const body = (await res.json()) as ApoDetailPayload;

    const items = body.groups.flatMap((g) => g.items);
    expect(items).toHaveLength(11);
    expect(items.find((i) => i.label === "アポランク")?.value).toBe("");
    expect(items.find((i) => i.label === "希望メーカー")?.value).toBe("");
  });

  it("★ 改行を含む長文をそのまま返す", async () => {
    const res = await detailGet(get("/api/apo-list/123"), ctx("123"));
    const body = (await res.json()) as ApoDetailPayload;

    const value = body.groups
      .flatMap((g) => g.items)
      .find((i) => i.label === "会話した内容")?.value;
    expect(value).toBe("初回訪問\n次回は来週");
  });

  it("★ 担当外の案件は 403（存在は伝えない）", async () => {
    h.record = fullRecord({
      [FIELD.clPerson]: "別人",
      [FIELD.salesperson]: "別人",
    });

    const res = await detailGet(get("/api/apo-list/123"), ctx("123"));
    expect(res.status).toBe(403);
  });

  it("★ 存在しない recordId は 404（壊れない）", async () => {
    h.record = null;

    const res = await detailGet(get("/api/apo-list/999"), ctx("999"));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: "案件が見つかりません",
    });
  });

  it("recordId が空なら 400", async () => {
    const res = await detailGet(get("/api/apo-list/"), ctx("   "));
    expect(res.status).toBe(400);
  });

  it("希望メーカーの列が見つからなくても他10項目は出る", async () => {
    h.desiredManufacturerFound = false;

    const res = await detailGet(get("/api/apo-list/123"), ctx("123"));
    const body = (await res.json()) as ApoDetailPayload;

    const items = body.groups.flatMap((g) => g.items);
    expect(items).toHaveLength(11);
    expect(items.find((i) => i.label === "希望メーカー")?.value).toBe("");
    expect(items.find((i) => i.label === "アポランク")?.value).toBe("A");
  });
});

describe("詳細の取得と既存 CSV", () => {
  it("★★ 詳細は専用の CSV で1件取る（既存 CSV を変えない）", async () => {
    await detailGet(get("/api/apo-list/123"), ctx("123"));
    await listGet(get("/api/apo-list"));

    expect(h.detailCsv).toHaveLength(1);
    expect(h.listCsv).toHaveLength(1);

    // 詳細の CSV には詳細用の列が入る
    expect(h.detailCsv[0]).toContain("f_rank");
    expect(h.detailCsv[0]).toContain("field-61");

    // 一覧の CSV は従来どおりで、詳細用の列は入らない
    expect(h.listCsv[0]).not.toContain("f_rank");
    expect(h.listCsv[0]).not.toContain("field-61");
  });

  it("担当者判定に要る列とお客様名も詳細の CSV に含める", async () => {
    await detailGet(get("/api/apo-list/123"), ctx("123"));

    expect(h.detailCsv[0]).toContain("f_cl");
    expect(h.detailCsv[0]).toContain("f_ap");
    expect(h.detailCsv[0]).toContain("f_name");
  });

  it("★ 同じ案件を続けて開いても取りに行くのは1回（短時間キャッシュ）", async () => {
    await detailGet(get("/api/apo-list/123"), ctx("123"));
    await detailGet(get("/api/apo-list/123"), ctx("123"));
    await detailGet(get("/api/apo-list/123"), ctx("123"));

    expect(h.detailCsv).toHaveLength(1);
  });

  it("別の案件は別々に取りに行く", async () => {
    await detailGet(get("/api/apo-list/123"), ctx("123"));
    await detailGet(get("/api/apo-list/456"), ctx("456"));

    expect(h.detailCsv).toHaveLength(2);
  });
});
