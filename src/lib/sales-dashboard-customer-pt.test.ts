import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  aggregateCustomerInfoPt,
  sumCustomerPtMonths,
  type CustomerInfoPtFieldMap,
} from "@/lib/sales-dashboard-customer-pt";

const FIELD_MAP: CustomerInfoPtFieldMap = {
  date: "field-1",
  customerStatus: "field-2",
  apStaff: "field-3",
  clStaff: "field-4",
  appt: "field-5",
  clpt: "field-6",
  customerName: "field-7",
};

function rec(fields: {
  date?: string;
  status?: string;
  ap?: string;
  cl?: string;
  appt?: string;
  clpt?: string;
  customer?: string;
}): { record: Record<string, unknown> } {
  return {
    record: {
      "field-1": fields.date ?? "2026-09-08",
      "field-2": fields.status ?? "契約",
      "field-3": fields.ap ?? "安藤太郎",
      "field-4": fields.cl ?? "近藤次郎",
      "field-5": fields.appt ?? "50",
      "field-6": fields.clpt ?? "50",
      "field-7": fields.customer ?? "赤枝正崇",
    },
  };
}

function ptOf(
  records: Array<{ record: Record<string, unknown> }>,
  name: string,
  ym = "2026-09",
): number {
  const m = aggregateCustomerInfoPt(records, FIELD_MAP).byStaffMonth;
  return m.get(name)?.get(ym)?.pt ?? 0;
}

function loggedJson(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const call = spy.mock.calls.at(0) ?? [];
  return JSON.parse(String(call[1])) as Record<string, unknown>;
}

let infoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("★ 帰属（APPT は AP担当者・CLPT は CL担当者）", () => {
  it("別人なら、それぞれに半分ずつ入る", () => {
    const records = [rec({ ap: "安藤太郎", cl: "近藤次郎", appt: "50", clpt: "50" })];
    expect(ptOf(records, "安藤太郎")).toBe(50);
    expect(ptOf(records, "近藤次郎")).toBe(50);
  });

  it("同一人物が AP と CL を兼ねるとき、合計が1人分になる", () => {
    // 転記側（computePtTransfer）は同一人物のとき APPT を 0 にする
    const records = [rec({ ap: "安藤太郎", cl: "安藤太郎", appt: "0", clpt: "100" })];
    expect(ptOf(records, "安藤太郎")).toBe(100);
    // 相手側に行が立たない
    expect(aggregateCustomerInfoPt(records, FIELD_MAP).byStaffMonth.size).toBe(1);
  });

  it("同一人物で両方に値が入っていても足し合わせる（二重計上はしない）", () => {
    const records = [rec({ ap: "安藤太郎", cl: "安藤太郎", appt: "40", clpt: "60" })];
    expect(ptOf(records, "安藤太郎")).toBe(100);
  });

  it("片方が空欄でも、もう片方には入る", () => {
    const records = [rec({ ap: "", cl: "近藤次郎", appt: "0", clpt: "100" })];
    expect(ptOf(records, "近藤次郎")).toBe(100);
  });

  it("「-」（未入力）は 0 として扱う", () => {
    const records = [rec({ appt: "-", clpt: "-" })];
    expect(ptOf(records, "安藤太郎")).toBe(0);
    expect(ptOf(records, "近藤次郎")).toBe(0);
  });

  it("複数レコードは担当者ごとに足し上がる", () => {
    const records = [
      rec({ appt: "50", clpt: "50" }),
      rec({ appt: "30", clpt: "30" }),
    ];
    expect(ptOf(records, "安藤太郎")).toBe(80);
    expect(ptOf(records, "近藤次郎")).toBe(80);
  });

  it("除外担当者には積まない", () => {
    const records = [rec({ ap: "トラーチ倶楽部", cl: "近藤次郎" })];
    const m = aggregateCustomerInfoPt(records, FIELD_MAP).byStaffMonth;
    expect(m.has("トラーチ倶楽部")).toBe(false);
    expect(m.get("近藤次郎")?.get("2026-09")?.pt).toBe(50);
  });
});

describe("★ キャンセルの除外", () => {
  it("顧客ステータスがキャンセルなら除外される", () => {
    const records = [rec({}), rec({ status: "キャンセル" })];
    expect(ptOf(records, "安藤太郎")).toBe(50);
    expect(loggedJson(infoSpy)).toMatchObject({ cancelled: 1, counted: 1 });
  });

  it("表記ゆれ（全角空白・全角英数）も NFKC で拾って除外する", () => {
    const records = [rec({ status: "　キャンセル　" })];
    expect(ptOf(records, "安藤太郎")).toBe(0);
    expect(loggedJson(infoSpy)).toMatchObject({ cancelled: 1 });
  });

  it("「キャンセル保留」のような別の値は除外しない（完全一致）", () => {
    const records = [rec({ status: "キャンセル保留" })];
    expect(ptOf(records, "安藤太郎")).toBe(50);
  });

  it("顧客ステータス列が無ければ除外は掛からない", () => {
    const records = [rec({ status: "キャンセル" })];
    const m = aggregateCustomerInfoPt(records, {
      ...FIELD_MAP,
      customerStatus: null,
    }).byStaffMonth;
    expect(m.get("安藤太郎")?.get("2026-09")?.pt).toBe(50);
  });
});

describe("★ 月の判定（初回契約日）", () => {
  it("初回契約日で月に振り分ける", () => {
    const records = [
      rec({ date: "2026-09-08" }),
      rec({ date: "2026-10-01" }),
      rec({ date: "2026年9月20日" }),
    ];
    const m = aggregateCustomerInfoPt(records, FIELD_MAP).byStaffMonth;
    expect(m.get("安藤太郎")?.get("2026-09")?.pt).toBe(100);
    expect(m.get("安藤太郎")?.get("2026-10")?.pt).toBe(50);
  });

  it("対象月では捨てない（過去の月も残る）", () => {
    const records = [rec({ date: "2025-04-03" }), rec({ date: "2026-09-08" })];
    const m = aggregateCustomerInfoPt(records, FIELD_MAP).byStaffMonth;
    expect([...(m.get("安藤太郎")?.keys() ?? [])].sort()).toEqual([
      "2025-04",
      "2026-09",
    ]);
  });

  it("日付が読めないレコードは落ち、件数がログに出る", () => {
    const records = [rec({}), rec({ date: "未定" }), rec({ date: "" })];
    aggregateCustomerInfoPt(records, FIELD_MAP);

    const json = loggedJson(infoSpy);
    expect(json.dateUnparsed).toBe(2);
    expect(json.counted).toBe(1);
    expect(json.dateSamples).toEqual(["未定"]);
  });
});

describe("★ 集計内訳のログ", () => {
  it("ループ後に1回だけ出す。件数だけで氏名・顧客名は出さない", () => {
    aggregateCustomerInfoPt([rec({}), rec({})], FIELD_MAP);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const text = (infoSpy.mock.calls.at(0) ?? []).map(String).join(" ");
    expect(text).toContain("[sales-dashboard] 総合PTの集計内訳");
    expect(text).not.toContain("安藤太郎");
    expect(text).not.toContain("近藤次郎");
    expect(text).not.toContain("赤枝正崇");
  });

  it("AP側・CL側の帰属回数を数える", () => {
    aggregateCustomerInfoPt(
      [rec({}), rec({ ap: "安藤太郎", cl: "安藤太郎" })],
      FIELD_MAP,
    );
    expect(loggedJson(infoSpy)).toMatchObject({
      apAttributed: 2,
      clAttributed: 2,
      counted: 2,
    });
  });

  it("AP も CL も空なら noName に数えて落とす", () => {
    aggregateCustomerInfoPt([rec({ ap: "", cl: "" })], FIELD_MAP);
    expect(loggedJson(infoSpy)).toMatchObject({ noName: 1, counted: 0 });
  });
});

describe("★ PT明細", () => {
  it("AP と CL が同一人物なら1行にまとめ、合計を出す", () => {
    const { breakdownByStaffMonth } = aggregateCustomerInfoPt(
      [rec({ ap: "安藤太郎", cl: "安藤太郎", appt: "0", clpt: "100" })],
      FIELD_MAP,
    );
    const rows = breakdownByStaffMonth.get("2026-09")?.["安藤太郎"] ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      customerName: "赤枝正崇",
      salesperson: "安藤太郎",
      pt: 100,
      dateYmd: "2026-09-08",
    });
  });

  it("別人なら、それぞれにその人の側の値が出る", () => {
    const { breakdownByStaffMonth } = aggregateCustomerInfoPt(
      [rec({ ap: "安藤太郎", cl: "近藤次郎", appt: "40", clpt: "60" })],
      FIELD_MAP,
    );
    const perMonth = breakdownByStaffMonth.get("2026-09") ?? {};
    expect(perMonth["安藤太郎"]?.[0]?.pt).toBe(40);
    expect(perMonth["近藤次郎"]?.[0]?.pt).toBe(60);
  });

  it("AP担当者・CL担当者の両方を各行に載せる", () => {
    const { breakdownByStaffMonth } = aggregateCustomerInfoPt(
      [rec({ ap: "安藤太郎", cl: "近藤次郎" })],
      FIELD_MAP,
    );
    const row = breakdownByStaffMonth.get("2026-09")?.["安藤太郎"]?.[0];
    expect(row).toMatchObject({ apPerson: "安藤太郎", clPerson: "近藤次郎" });
  });

  it("PT が 0 の行は明細に出さない", () => {
    const { breakdownByStaffMonth } = aggregateCustomerInfoPt(
      [rec({ ap: "安藤太郎", cl: "近藤次郎", appt: "0", clpt: "100" })],
      FIELD_MAP,
    );
    const perMonth = breakdownByStaffMonth.get("2026-09") ?? {};
    expect(perMonth["安藤太郎"]).toBeUndefined();
    expect(perMonth["近藤次郎"]?.[0]?.pt).toBe(100);
  });

  it("日付の新しい順に並ぶ", () => {
    const { breakdownByStaffMonth } = aggregateCustomerInfoPt(
      [rec({ date: "2026-09-01" }), rec({ date: "2026-09-20" })],
      FIELD_MAP,
    );
    const rows = breakdownByStaffMonth.get("2026-09")?.["安藤太郎"] ?? [];
    expect(rows.map((r) => r.dateYmd)).toEqual(["2026-09-20", "2026-09-01"]);
  });
});

describe("★ 月の取り出し", () => {
  const m = aggregateCustomerInfoPt(
    [
      rec({ date: "2026-09-08" }),
      rec({ date: "2026-10-01" }),
      rec({ date: "2026-11-01" }),
    ],
    FIELD_MAP,
  ).byStaffMonth;

  it("単月を取り出す", () => {
    expect(sumCustomerPtMonths(m, ["2026-09"]).get("安藤太郎")).toBe(50);
  });

  it("複数月を足す（年度の累計）", () => {
    expect(
      sumCustomerPtMonths(m, ["2026-09", "2026-10", "2026-11"]).get("安藤太郎"),
    ).toBe(150);
  });

  it("該当の無い月は含めない", () => {
    expect(sumCustomerPtMonths(m, ["2026-03"]).size).toBe(0);
  });
});
