import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AP_RANKING_INTRODUCTION_ROUTES,
  INTRODUCTION_ROUTE_OPTIONS,
} from "@/lib/customer-info-form/options";
import {
  aggregateCustomerInfoApPt,
  buildApRanking,
  isApRankingIntroductionRoute,
  resolveCustomerInfoApPtFieldMap,
  type CustomerInfoApPtFieldMap,
} from "@/lib/sales-dashboard-ap-pt";
import {
  buildSalesDashboardPayload,
  type SalesDashboardCore,
  type SalesDashboardSelection,
} from "@/lib/sales-dashboard-data";
import { personalizeSalesDashboardPayload } from "@/lib/sales-dashboard-personalize";
import { sumCustomerPtMonths } from "@/lib/sales-dashboard-customer-pt";

/**
 * APランキング（営業ランキングの AP部門）。
 *
 * お客様情報アプリの **APPT だけ**を AP担当者ごとに合計する。対象は導入経緯が
 * ダイレクト・お客様紹介・(DC)工務店OBリストの契約。アポ件数タブ（アポ情報
 * アプリの件数）とは別の部門として足したもので、総合PT・アポ件数・支社別・
 * ホームのカードの数字は変えない。
 *
 * ここで固定するのは次の4つ。
 *   - 集計の条件（APPT のみ・導入経緯・キャンセル・除外語・初回契約日）
 *   - 並び順（APPT → アポ実績数）と、APPT が 0 の人を載せないこと
 *   - 目標・達成率を応答に含めないこと
 *   - 既存の部門が変わっていないこと
 */

const FIELD_MAP: CustomerInfoApPtFieldMap = {
  date: "field-1",
  customerStatus: "field-2",
  apStaff: "field-3",
  appt: "field-5",
  introduction: "field-7",
};

const CL_STAFF_ID = "field-4";
const CLPT_ID = "field-6";

/** 対象になるレコード。上書きして条件を1つずつ外す */
function rec(
  fields: {
    date?: string;
    status?: string;
    ap?: string;
    cl?: string;
    appt?: string;
    clpt?: string;
    introduction?: string;
  } = {},
) {
  return {
    record: {
      "field-1": fields.date ?? "2026-09-08",
      "field-2": fields.status ?? "工事待ち",
      "field-3": fields.ap ?? "営業 一郎",
      [CL_STAFF_ID]: fields.cl ?? "営業 二郎",
      "field-5": fields.appt ?? "500",
      [CLPT_ID]: fields.clpt ?? "500",
      "field-7": fields.introduction ?? "ダイレクト",
    },
  };
}

let infoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  infoSpy.mockRestore();
});

function apptOf(
  records: Array<{ record?: unknown }>,
  name: string,
  ym = "2026-09",
): number {
  return (
    aggregateCustomerInfoApPt(records, FIELD_MAP).get(name)?.get(ym)?.pt ?? 0
  );
}

function loggedCounts(): Record<string, unknown> {
  const call = infoSpy.mock.calls.find(
    (c) => c[0] === "[sales-dashboard] APランキングの集計内訳",
  );
  expect(call, "集計内訳のログが出ていない").toBeTruthy();
  return JSON.parse(String(call![1])) as Record<string, unknown>;
}

describe("★ APPT だけを集計する", () => {
  it("★ AP担当者に APPT が入る", () => {
    expect(apptOf([rec({ appt: "500" })], "営業 一郎")).toBe(500);
  });

  it("★ CLPT は含めない", () => {
    // CLPT がどれだけ大きくても、AP担当者の値は APPT のまま
    expect(apptOf([rec({ appt: "500", clpt: "9000" })], "営業 一郎")).toBe(500);
  });

  it("★ CL担当者には何も入らない（CL としての実績は見ない）", () => {
    const agg = aggregateCustomerInfoApPt(
      [rec({ ap: "営業 一郎", cl: "営業 二郎" })],
      FIELD_MAP,
    );

    expect([...agg.keys()]).toEqual(["営業 一郎"]);
  });

  it("★ AP と CL が同一人物でも APPT だけ（合算しない）", () => {
    // 総合PTはこの人に APPT＋CLPT を足す。APランキングは APPT のみ
    const records = [
      rec({ ap: "営業 一郎", cl: "営業 一郎", appt: "500", clpt: "500" }),
    ];

    expect(apptOf(records, "営業 一郎")).toBe(500);
  });

  it("同じ担当者の複数レコードは足し合わせる", () => {
    expect(
      apptOf([rec({ appt: "500" }), rec({ appt: "300" })], "営業 一郎"),
    ).toBe(800);
  });

  it("カンマ付き・未入力（-）の APPT も総合PTと同じ読み方", () => {
    expect(apptOf([rec({ appt: "1,200" })], "営業 一郎")).toBe(1200);
    expect(apptOf([rec({ appt: "-" })], "営業 一郎")).toBe(0);
  });

  it("AP担当者が空のレコードは数えない", () => {
    const agg = aggregateCustomerInfoApPt([rec({ ap: "" })], FIELD_MAP);

    expect(agg.size).toBe(0);
    expect(loggedCounts()).toMatchObject({ noName: 1, counted: 0 });
  });
});

describe("★ 導入経緯で絞る", () => {
  it("★ 対象の3つは数える", () => {
    for (const introduction of [
      "ダイレクト",
      "お客様紹介",
      "(DC)工務店OBリスト",
    ]) {
      expect(apptOf([rec({ introduction })], "営業 一郎"), introduction).toBe(
        500,
      );
    }
  });

  it("★ 3つ以外の選択肢は、どれも数えない", () => {
    const others = INTRODUCTION_ROUTE_OPTIONS.filter(
      (o) => !(AP_RANKING_INTRODUCTION_ROUTES as readonly string[]).includes(o),
    );
    // 14個の選択肢のうち、対象外は11個
    expect(others).toHaveLength(11);

    for (const introduction of others) {
      expect(apptOf([rec({ introduction })], "営業 一郎"), introduction).toBe(0);
    }
  });

  it("★ 導入経緯が空のレコードは数えない", () => {
    expect(apptOf([rec({ introduction: "" })], "営業 一郎")).toBe(0);
    expect(apptOf([rec({ introduction: "  " })], "営業 一郎")).toBe(0);
  });

  it("★ 完全一致。部分一致や表記ちがいでは数えない", () => {
    for (const introduction of [
      "ダイレクト（再訪）",
      "お客様紹介A",
      // 括弧が全角
      "（DC）工務店OBリスト",
      // 括弧なし
      "DC工務店OBリスト",
      // 小文字
      "(dc)工務店obリスト",
      "工務店OBリスト",
    ]) {
      expect(apptOf([rec({ introduction })], "営業 一郎"), introduction).toBe(0);
    }
  });

  it("前後の空白だけは落として比べる", () => {
    expect(apptOf([rec({ introduction: " お客様紹介 " })], "営業 一郎")).toBe(
      500,
    );
  });

  it("対象と対象外が混ざっていれば、対象ぶんだけ足す", () => {
    const records = [
      rec({ appt: "500", introduction: "ダイレクト" }),
      rec({ appt: "700", introduction: "タイナビ" }),
      rec({ appt: "300", introduction: "(DC)工務店OBリスト" }),
      rec({ appt: "900", introduction: "" }),
    ];

    expect(apptOf(records, "営業 一郎")).toBe(800);
    expect(loggedCounts()).toMatchObject({
      total: 4,
      counted: 2,
      introductionOther: 1,
      introductionEmpty: 1,
    });
  });

  it("★ 対象の3つは選択肢の定義にある文字列そのもの（新しく書いていない）", () => {
    expect([...AP_RANKING_INTRODUCTION_ROUTES]).toEqual([
      "ダイレクト",
      "お客様紹介",
      "(DC)工務店OBリスト",
    ]);
    for (const route of AP_RANKING_INTRODUCTION_ROUTES) {
      expect(INTRODUCTION_ROUTE_OPTIONS, route).toContain(route);
      expect(isApRankingIntroductionRoute(route), route).toBe(true);
    }
  });
});

describe("★ キャンセルの除外（総合PTと同じ）", () => {
  it("★ 顧客ステータスがキャンセルのレコードは数えない", () => {
    expect(apptOf([rec({ status: "キャンセル" })], "営業 一郎")).toBe(0);
    expect(loggedCounts()).toMatchObject({ cancelled: 1, counted: 0 });
  });

  it("完全一致。「キャンセル」を含むだけの値は数える", () => {
    expect(apptOf([rec({ status: "キャンセル保留" })], "営業 一郎")).toBe(500);
  });

  it("顧客ステータスの列を解決できないときは、除外を掛けずに数える", () => {
    const agg = aggregateCustomerInfoApPt([rec({ status: "キャンセル" })], {
      ...FIELD_MAP,
      customerStatus: null,
    });

    expect(agg.get("営業 一郎")?.get("2026-09")?.pt).toBe(500);
  });
});

describe("★ 担当者名の除外語（総合PTと同じ）", () => {
  it("★ トラーチ倶楽部・大和ハウス・卸案件を含む担当者は数えない", () => {
    for (const ap of ["トラーチ倶楽部", "大和ハウス 奈良", "卸案件（A社）"]) {
      const agg = aggregateCustomerInfoApPt([rec({ ap })], FIELD_MAP);
      expect(agg.size, ap).toBe(0);
    }
  });

  it("除外した件数がログに残る（氏名は出さない）", () => {
    aggregateCustomerInfoApPt(
      [rec({ ap: "トラーチ倶楽部" }), rec({ ap: "営業 一郎" })],
      FIELD_MAP,
    );

    expect(loggedCounts()).toMatchObject({ excludedName: 1, counted: 1 });
    const text = infoSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(text).not.toContain("営業 一郎");
    expect(text).not.toContain("トラーチ倶楽部");
  });
});

describe("★ 月の判定（初回契約日）", () => {
  it("★ 初回契約日の月に積む", () => {
    const records = [
      rec({ date: "2026-09-30", appt: "500" }),
      rec({ date: "2026-10-01", appt: "300" }),
    ];

    expect(apptOf(records, "営業 一郎", "2026-09")).toBe(500);
    expect(apptOf(records, "営業 一郎", "2026-10")).toBe(300);
  });

  it("日付を読めないレコードは数えない", () => {
    expect(
      aggregateCustomerInfoApPt([rec({ date: "" })], FIELD_MAP).size,
    ).toBe(0);
    expect(loggedCounts()).toMatchObject({ dateUnparsed: 1, counted: 0 });
  });

  it("選択月・年度累計は同じ集計から取り出せる", () => {
    const agg = aggregateCustomerInfoApPt(
      [
        rec({ date: "2026-09-08", appt: "500" }),
        rec({ date: "2026-10-08", appt: "300" }),
      ],
      FIELD_MAP,
    );

    expect(sumCustomerPtMonths(agg, ["2026-09"]).get("営業 一郎")).toBe(500);
    expect(
      sumCustomerPtMonths(agg, ["2026-09", "2026-10"]).get("営業 一郎"),
    ).toBe(800);
  });
});

describe("★ 導入経緯の列の解決", () => {
  const PT_MAP = {
    date: "field-1",
    customerStatus: "field-2",
    apStaff: "field-3",
    clStaff: "field-4",
    appt: "field-5",
    clpt: "field-6",
    customerName: null,
  };
  const KEY = "CUSTOMER_INFO_FIELD_INTRODUCTION";
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[KEY];
    delete process.env[KEY];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it("★ 環境変数 CUSTOMER_INFO_FIELD_INTRODUCTION の列を使う", () => {
    process.env[KEY] = "field-99";
    const fields = [
      { uniqueId: "field-29", caption: "導入経緯" },
      { uniqueId: "field-99", caption: "導入経緯" },
    ];

    expect(resolveCustomerInfoApPtFieldMap(fields, PT_MAP)?.introduction).toBe(
      "field-99",
    );
  });

  it("未設定なら見出し「導入経緯」で解決する（フォームと同じ解決関数）", () => {
    const fields = [{ uniqueId: "field-29", caption: "導入経緯" }];

    expect(resolveCustomerInfoApPtFieldMap(fields, PT_MAP)).toEqual({
      date: "field-1",
      customerStatus: "field-2",
      apStaff: "field-3",
      appt: "field-5",
      introduction: "field-29",
    });
  });

  it("★ 解決できなければ null（絞り込めないまま集計しない）", () => {
    const fields = [{ uniqueId: "field-1", caption: "初回契約日" }];

    expect(resolveCustomerInfoApPtFieldMap(fields, PT_MAP)).toBeNull();
  });
});

describe("★ 並び順と載せる対象", () => {
  const rank = (
    appt: Record<string, number>,
    apo: Record<string, number> = {},
  ) =>
    buildApRanking(
      new Map(Object.entries(appt)),
      new Map(Object.entries(apo)),
      "",
    );

  it("★ APPT の高い順に並ぶ", () => {
    const rows = rank({ 安藤: 300, 伊藤: 900, 江藤: 600 });

    expect(rows.map((r) => r.staffName)).toEqual(["伊藤", "江藤", "安藤"]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("★ APPT が同じなら、アポ実績数の多い順", () => {
    const rows = rank(
      { 安藤: 500, 伊藤: 500, 江藤: 500 },
      { 安藤: 2, 伊藤: 9, 江藤: 5 },
    );

    expect(rows.map((r) => r.staffName)).toEqual(["伊藤", "江藤", "安藤"]);
  });

  it("★ アポ実績数が多くても、APPT が低ければ下になる", () => {
    const rows = rank({ 安藤: 900, 伊藤: 100 }, { 安藤: 0, 伊藤: 99 });

    expect(rows.map((r) => r.staffName)).toEqual(["安藤", "伊藤"]);
  });

  it("APPT もアポ実績数も同じなら氏名の五十音順", () => {
    const rows = rank({ 近藤: 500, 安藤: 500, 伊藤: 500 });

    expect(rows.map((r) => r.staffName)).toEqual(["安藤", "伊藤", "近藤"]);
  });

  it("★ APPT が 0 の人は載らない", () => {
    const rows = rank({ 安藤: 500, 伊藤: 0 }, { 伊藤: 30 });

    expect(rows.map((r) => r.staffName)).toEqual(["安藤"]);
  });

  it("★ アポ実績数だけがある人は載らない（APPT が無い）", () => {
    const rows = rank({ 安藤: 500 }, { 安藤: 3, 近藤: 20 });

    expect(rows.map((r) => r.staffName)).toEqual(["安藤"]);
  });

  it("アポ実績数が引けない人は 0 件として載る", () => {
    expect(rank({ 安藤: 500 })[0]).toMatchObject({ appt: 500, apoCount: 0 });
  });

  it("除外担当者は載らない", () => {
    const rows = rank({ 安藤: 500, トラーチ倶楽部: 9000 });

    expect(rows.map((r) => r.staffName)).toEqual(["安藤"]);
  });

  it("上位3位に isPodium が付く", () => {
    const rows = rank({ 安藤: 400, 伊藤: 300, 江藤: 200, 近藤: 100 });

    expect(rows.map((r) => r.isPodium)).toEqual([true, true, true, false]);
  });

  it("★ 行に目標・達成率の項目が無い", () => {
    const row = rank({ 安藤: 500 }, { 安藤: 3 })[0]!;

    expect(Object.keys(row).sort()).toEqual(
      ["apoCount", "appt", "isPodium", "isSelf", "rank", "staffName"].sort(),
    );
    for (const key of ["targetPt", "targetApoCount", "achievementRate"]) {
      expect(row, key).not.toHaveProperty(key);
    }
  });
});

// ─────────────────────── 応答（公開の入口ごと確かめる）

const YM = "2026-09";

const SELECTION: SalesDashboardSelection = {
  fiscalYear: { key: "2026", startYear: 2026, label: "2026年度" },
  fiscalYearOptions: [{ key: "2026", label: "2026年度" }],
  month: { kind: "month", ym: YM, year: 2026, month1: 9, label: "2026年9月" },
};

const ANNUAL: SalesDashboardSelection = {
  ...SELECTION,
  month: { kind: "annual" } as SalesDashboardSelection["month"],
};

function monthly<T>(
  values: Record<string, T>,
  wrap: (name: string, v: T) => unknown,
  ym = YM,
) {
  const out = new Map<string, Map<string, never>>();
  for (const [name, v] of Object.entries(values)) {
    out.set(name, new Map([[ym, wrap(name, v) as never]]));
  }
  return out;
}

function core(input: {
  pt?: Record<string, number>;
  apo?: Record<string, number>;
  targets?: Record<string, number>;
  apoTargets?: Record<string, number>;
  /** 担当者名 → その月の APPT。undefined なら AP は集計していない扱い */
  apPt?: Record<string, number> | null;
}): SalesDashboardCore {
  const targetsByStaffMonth = new Map<
    string,
    Map<string, { pt: number; apoCount: number; branchRaw: string }>
  >();
  for (const [name, pt] of Object.entries(input.targets ?? {})) {
    targetsByStaffMonth.set(
      name,
      new Map([[YM, { pt, apoCount: 0, branchRaw: "奈良本社" }]]),
    );
  }
  for (const [name, apoCount] of Object.entries(input.apoTargets ?? {})) {
    const byMonth = targetsByStaffMonth.get(name) ?? new Map();
    const cur = byMonth.get(YM) ?? { pt: 0, apoCount: 0, branchRaw: "奈良本社" };
    byMonth.set(YM, { ...cur, apoCount });
    targetsByStaffMonth.set(name, byMonth);
  }

  return {
    computedYm: YM,
    ptByStaffMonth: monthly(input.pt ?? {}, (name, pt) => ({ name, pt })),
    contractCountByStaffMonth: new Map(),
    ptBreakdownByStaffMonth: new Map(),
    ...(input.apPt === undefined
      ? {}
      : {
          apPtByStaffMonth:
            input.apPt === null
              ? null
              : monthly(input.apPt, (name, pt) => ({ name, pt })),
        }),
    apo: {
      ok: true,
      byStaffMonth: monthly(input.apo ?? {}, (name, apoCount) => ({
        name,
        apoCount,
      })),
    },
    tenka: { ok: false, error: "未設定" },
    targets: { byStaffMonth: targetsByStaffMonth, available: true },
    rosterBranchByStaff: new Map(),
    apoEnabled: true,
  };
}

/** 既存の部門が共有している材料。APランキングを足しても変わってはいけない */
const BASE = {
  pt: { 安藤: 900, 伊藤: 400, 江藤: 0 },
  apo: { 安藤: 2, 伊藤: 7, 近藤: 5 },
  targets: { 安藤: 1000, 伊藤: 800, 江藤: 500 },
  apoTargets: { 安藤: 10, 近藤: 4, 佐藤: 6 },
};

describe("★ 応答の APランキング", () => {
  it("★ APPT とアポ実績数が載り、APPT → アポ実績数の順に並ぶ", () => {
    const payload = buildSalesDashboardPayload(
      core({ ...BASE, apPt: { 安藤: 300, 伊藤: 300, 近藤: 800 } }),
      "",
      SELECTION,
    );

    expect(payload.apReady).toBe(true);
    expect(
      payload.apRanking.map((r) => [r.rank, r.staffName, r.appt, r.apoCount]),
    ).toEqual([
      [1, "近藤", 800, 5],
      // APPT が同じ 300。アポ実績数は 伊藤 7 件 > 安藤 2 件
      [2, "伊藤", 300, 7],
      [3, "安藤", 300, 2],
    ]);
  });

  it("★ アポ実績数はアポ件数タブと同じ数字", () => {
    const payload = buildSalesDashboardPayload(
      core({ ...BASE, apPt: { 安藤: 300, 伊藤: 300, 近藤: 800 } }),
      "",
      SELECTION,
    );
    const apoCountByName = new Map(
      payload.apoRanking.map((r) => [r.staffName, r.apoCount]),
    );

    for (const row of payload.apRanking) {
      expect(row.apoCount, row.staffName).toBe(
        apoCountByName.get(row.staffName),
      );
    }
  });

  it("★ APPT が 0 の人・目標だけある人は載らない", () => {
    const payload = buildSalesDashboardPayload(
      // 佐藤はアポ目標だけがある。江藤は PT 目標だけがある
      core({ ...BASE, apPt: { 安藤: 300, 江藤: 0 } }),
      "",
      SELECTION,
    );

    expect(payload.apRanking.map((r) => r.staffName)).toEqual(["安藤"]);
    // 同じ人たちが、総合PT・アポ件数には目標があるので載っている
    expect(payload.ranking.map((r) => r.staffName)).toContain("江藤");
    expect(payload.apoRanking.map((r) => r.staffName)).toContain("佐藤");
  });

  it("★ 達成率と PT目標が応答に含まれない", () => {
    const payload = buildSalesDashboardPayload(
      core({ ...BASE, apPt: { 安藤: 300 } }),
      "",
      SELECTION,
    );

    expect(payload.apRanking).toHaveLength(1);
    for (const row of payload.apRanking) {
      expect(row).not.toHaveProperty("targetPt");
      expect(row).not.toHaveProperty("targetApoCount");
      expect(row).not.toHaveProperty("achievementRate");
      expect(row).not.toHaveProperty("sharePercent");
    }
  });

  it("年間を選ぶと、年度内の月を足した APPT になる", () => {
    const c = core({ ...BASE, apPt: { 安藤: 300 } });
    c.apPtByStaffMonth!.get("安藤")!.set("2026-10", { name: "安藤", pt: 200 });

    const payload = buildSalesDashboardPayload(c, "", ANNUAL);

    expect(payload.apRanking[0]).toMatchObject({ staffName: "安藤", appt: 500 });
  });

  it("導入経緯の列を解決できなかったときは apReady が false で、行は空", () => {
    for (const apPt of [null, undefined]) {
      const payload = buildSalesDashboardPayload(
        core({ ...BASE, apPt }),
        "",
        SELECTION,
      );

      expect(payload.apReady).toBe(false);
      expect(payload.apRanking).toEqual([]);
    }
  });

  it("本人の行に isSelf が付く（共有キャッシュから取り出したあと）", () => {
    const payload = buildSalesDashboardPayload(
      core({ ...BASE, apPt: { 安藤: 300, 伊藤: 200 } }),
      "",
      SELECTION,
    );

    const mine = personalizeSalesDashboardPayload(payload, "伊藤");

    expect(mine.apRanking.map((r) => [r.staffName, r.isSelf])).toEqual([
      ["安藤", false],
      ["伊藤", true],
    ]);
  });
});

/**
 * APランキングは**足しただけ**であること。
 *
 * AP の材料（apPtByStaffMonth）の有無・中身を変えても、既存の部門の応答が
 * 1つも変わらないことを、応答をまるごと比べて確かめる。
 */
describe("★ 既存の部門は変わっていない", () => {
  const without = buildSalesDashboardPayload(core(BASE), "安藤", SELECTION);
  const withAp = buildSalesDashboardPayload(
    core({ ...BASE, apPt: { 安藤: 300, 伊藤: 9000, 近藤: 800, 佐藤: 50 } }),
    "安藤",
    SELECTION,
  );

  it("★ 総合PTランキングが変わっていない", () => {
    expect(withAp.ranking).toEqual(without.ranking);
    expect(withAp.kpi).toEqual(without.kpi);
    expect(withAp.ptBreakdownByStaff).toEqual(without.ptBreakdownByStaff);
    // 中身も確かめる（APPT 9000 の伊藤が総合PTで上に来たりしない）
    const top = withAp.ranking.map((r) => [r.staffName, r.pt]);
    expect(top.slice(0, 3)).toEqual([
      ["安藤", 900],
      ["伊藤", 400],
      ["江藤", 0],
    ]);
    // どの行にも APPT（300・9000・800・50）が混ざっていない
    expect(withAp.ranking.reduce((s, r) => s + r.pt, 0)).toBe(1300);
  });

  it("★ アポ件数タブが変わっていない", () => {
    expect(withAp.apoRanking).toEqual(without.apoRanking);
    expect(withAp.apoKpi).toEqual(without.apoKpi);
    expect(withAp.apoReady).toBe(without.apoReady);
    const rows = withAp.apoRanking.map((r) => [
      r.staffName,
      r.apoCount,
      r.targetApoCount,
    ]);
    expect(rows.slice(0, 3)).toEqual([
      ["伊藤", 7, 0],
      ["近藤", 5, 4],
      ["安藤", 2, 10],
    ]);
    // 実績は無いが目標がある人は、従来どおり載る
    expect(rows).toContainEqual(["佐藤", 0, 6]);
    // 件数の合計にも APPT が混ざっていない
    expect(withAp.apoRanking.reduce((s, r) => s + r.apoCount, 0)).toBe(14);
  });

  it("★ 支社別が変わっていない（PT・アポ件数とも）", () => {
    expect(withAp.progress).toEqual(without.progress);
    expect(withAp.annualProgress).toEqual(without.annualProgress);
    // 合計にも APPT が混ざっていない
    expect(withAp.progress.company).toEqual(without.progress.company);
  });

  it("★ トップページのカード（scope=self）の材料が変わっていない", () => {
    // カードは総合PTランキングの自分の行と行数だけを使う
    const selfOf = (p: typeof withAp) => {
      const self = p.ranking.find((r) => r.isSelf);
      return {
        rank: self?.rank ?? null,
        totalCount: p.ranking.length,
        pt: self?.pt ?? 0,
        targetPt: self?.targetPt ?? 0,
        achievementRate: self?.achievementRate ?? 0,
        periodLabel: p.periodLabel,
      };
    };

    expect(selfOf(withAp)).toEqual(selfOf(without));
    expect(selfOf(withAp)).toMatchObject({ rank: 1, pt: 900, targetPt: 1000 });
  });

  it("AP の材料以外に差が出ていない（応答全体を比べる）", () => {
    const strip = (p: typeof withAp) => {
      const { apRanking: _apRanking, apReady: _apReady, ...rest } = p;
      return rest;
    };

    expect(strip(withAp)).toEqual(strip(without));
  });
});
