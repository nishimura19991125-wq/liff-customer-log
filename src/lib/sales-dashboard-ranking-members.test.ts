import { describe, expect, it } from "vitest";

import {
  buildSalesDashboardPayload,
  type SalesDashboardCore,
  type SalesDashboardSelection,
} from "@/lib/sales-dashboard-data";

/**
 * ランキングに誰が載るか。**公開の入口ごと**確かめる。
 *
 * 対象は「その月に実績（PT・契約件数）がある人」または「その月に目標がある人」。
 * 支社別（SalesProgressBranches）と顔ぶれをそろえるのが狙いなので、
 * 支社別の members と一致することも併せて固定する。
 */

const YM = "2026-09";

const SELECTION: SalesDashboardSelection = {
  fiscalYear: { key: "2026", startYear: 2026, label: "2026年度" },
  fiscalYearOptions: [{ key: "2026", label: "2026年度" }],
  month: {
    kind: "month",
    ym: YM,
    year: 2026,
    month1: 9,
    label: "2026年9月",
  },
};

function core(input: {
  /** 担当者名 → その月の PT 実績 */
  pt?: Record<string, number>;
  /** 担当者名 → その月の契約件数 */
  contracts?: Record<string, number>;
  /** 担当者名 → その月の目標 PT */
  targets?: Record<string, number>;
  /** 担当者名 → その月のアポ目標 */
  apoTargets?: Record<string, number>;
  /** 別の月にだけ目標がある人 */
  targetsOtherMonth?: Record<string, number>;
  /** 担当者名 → その月のアポ件数 */
  apo?: Record<string, number>;
}): SalesDashboardCore {
  const ptByStaffMonth = new Map<
    string,
    Map<string, { name: string; pt: number }>
  >();
  for (const [name, pt] of Object.entries(input.pt ?? {})) {
    ptByStaffMonth.set(name, new Map([[YM, { name, pt }]]));
  }

  const contractCountByStaffMonth = new Map<string, Map<string, number>>();
  for (const [name, count] of Object.entries(input.contracts ?? {})) {
    contractCountByStaffMonth.set(name, new Map([[YM, count]]));
  }

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
  for (const [name, pt] of Object.entries(input.targetsOtherMonth ?? {})) {
    targetsByStaffMonth.set(
      name,
      new Map([["2026-08", { pt, apoCount: 0, branchRaw: "奈良本社" }]]),
    );
  }

  const apoByStaffMonth = new Map<
    string,
    Map<string, { name: string; apoCount: number }>
  >();
  for (const [name, apoCount] of Object.entries(input.apo ?? {})) {
    apoByStaffMonth.set(name, new Map([[YM, { name, apoCount }]]));
  }

  return {
    computedYm: YM,
    ptByStaffMonth,
    contractCountByStaffMonth,
    ptBreakdownByStaffMonth: new Map(),
    apo: { ok: true, byStaffMonth: apoByStaffMonth },
    tenka: { ok: false, error: "未設定" },
    targets: { byStaffMonth: targetsByStaffMonth, available: true },
    rosterBranchByStaff: new Map(),
    apoEnabled: false,
  };
}

function rankingNames(c: SalesDashboardCore): string[] {
  return buildSalesDashboardPayload(c, "", SELECTION).ranking.map(
    (r) => r.staffName,
  );
}

function apoRanking(c: SalesDashboardCore) {
  return buildSalesDashboardPayload(c, "", SELECTION).apoRanking;
}

function apoNames(c: SalesDashboardCore): string[] {
  return apoRanking(c).map((r) => r.staffName);
}

/** 支社別に並ぶ担当者（全支社ぶん） */
function branchMemberNames(c: SalesDashboardCore): string[] {
  return buildSalesDashboardPayload(c, "", SELECTION)
    .progress.branches.flatMap((b) => b.members.map((m) => m.staffName))
    .sort();
}

describe("★ ランキングに載る対象", () => {
  it("実績が無く目標だけある人が載る", () => {
    const names = rankingNames(
      core({ pt: { 安藤: 100 }, targets: { 近藤: 500 } }),
    );
    expect(names).toContain("近藤");
  });

  it("その人の PT は 0 で載る", () => {
    const payload = buildSalesDashboardPayload(
      core({ pt: { 安藤: 100 }, targets: { 近藤: 500 } }),
      "",
      SELECTION,
    );
    const row = payload.ranking.find((r) => r.staffName === "近藤");
    expect(row).toMatchObject({ pt: 0, targetPt: 500, achievementRate: 0 });
  });

  it("実績も目標も無い人は載らない", () => {
    // 別の月にだけ目標がある人は、その月のランキングには載らない
    const names = rankingNames(
      core({ pt: { 安藤: 100 }, targetsOtherMonth: { 伊藤: 500 } }),
    );
    expect(names).toEqual(["安藤"]);
  });

  it("契約件数だけある人も従来どおり載る", () => {
    const names = rankingNames(core({ contracts: { 近藤: 2 } }));
    expect(names).toEqual(["近藤"]);
  });

  it("目標が 0 で登録されている人も載る（未登録とは別扱い）", () => {
    const names = rankingNames(core({ targets: { 近藤: 0 } }));
    expect(names).toEqual(["近藤"]);
  });

  it("除外担当者は載らない", () => {
    const names = rankingNames(
      core({
        pt: { 安藤: 100 },
        targets: { トラーチ倶楽部: 500, 大和ハウス: 500, "-": 500 },
      }),
    );
    expect(names).toEqual(["安藤"]);
  });

  it("全社 PT は目標だけの人を足しても変わらない", () => {
    const withTargetOnly = buildSalesDashboardPayload(
      core({ pt: { 安藤: 100 }, targets: { 近藤: 500 } }),
      "",
      SELECTION,
    );
    expect(withTargetOnly.kpi.pt).toBe(100);
  });
});

describe("★ PT が 0 の人の並び", () => {
  it("目標の高い順に並ぶ", () => {
    const names = rankingNames(
      core({ targets: { 安藤: 100, 近藤: 300, 伊藤: 200 } }),
    );
    expect(names).toEqual(["近藤", "伊藤", "安藤"]);
  });

  it("実績がある人より下に来る", () => {
    const names = rankingNames(
      core({ pt: { 安藤: 1 }, targets: { 近藤: 9_999_999 } }),
    );
    expect(names).toEqual(["安藤", "近藤"]);
  });

  it("順位は連番のまま付く", () => {
    const payload = buildSalesDashboardPayload(
      core({ targets: { 安藤: 100, 近藤: 300 } }),
      "",
      SELECTION,
    );
    expect(payload.ranking.map((r) => r.rank)).toEqual([1, 2]);
  });
});

describe("★ 支社別と顔ぶれがそろう", () => {
  it("実績・目標が混ざっても両者が一致する", () => {
    const c = core({
      pt: { 安藤: 100 },
      contracts: { 伊藤: 2 },
      targets: { 近藤: 500, 安藤: 300 },
    });
    expect(rankingNames(c).sort()).toEqual(branchMemberNames(c));
  });

  it("目標だけの人も両方に載る", () => {
    const c = core({ pt: { 安藤: 100 }, targets: { 近藤: 500 } });
    expect(rankingNames(c).sort()).toEqual(branchMemberNames(c));
  });

  /**
   * 既知の差。支社別はアポ実績も対象に含めるが、総合PTランキングは
   * PT・契約件数・目標だけを見る。**アポ実績しか無い人はランキングに
   * 載らない。** アポを含めるかは業務判断なので、現状を固定しておく。
   */
  it("アポ実績しか無い人は支社別にだけ載る（既知の差）", () => {
    const c = core({ pt: { 安藤: 100 }, apo: { 江藤: 3 } });
    expect(rankingNames(c)).toEqual(["安藤"]);
    expect(branchMemberNames(c)).toEqual(["安藤", "江藤"]);
  });
});

describe("★ アポ件数部門も総合PTと同じ形", () => {
  it("アポ実績が無く目標だけある人が載る", () => {
    expect(apoNames(core({ apo: { 安藤: 3 }, apoTargets: { 近藤: 10 } }))).toEqual([
      "安藤",
      "近藤",
    ]);
  });

  it("実績も目標も無い人は載らない", () => {
    // PT の実績しか無い人はアポ件数部門には載らない
    expect(apoNames(core({ apo: { 安藤: 3 }, pt: { 伊藤: 100 } }))).toEqual([
      "安藤",
    ]);
  });

  it("除外担当者は載らない", () => {
    const names = apoNames(
      core({
        apo: { 安藤: 3, トラーチ倶楽部: 9 },
        apoTargets: { 大和ハウス: 10 },
      }),
    );
    expect(names).toEqual(["安藤"]);
  });

  it("アポ0件の人が目標の高い順に並ぶ", () => {
    const names = apoNames(
      core({ apoTargets: { 安藤: 10, 近藤: 30, 伊藤: 20 } }),
    );
    expect(names).toEqual(["近藤", "伊藤", "安藤"]);
  });

  it("実績がある人はアポ0件の人より上に来る", () => {
    const names = apoNames(
      core({ apo: { 安藤: 1 }, apoTargets: { 近藤: 999 } }),
    );
    expect(names).toEqual(["安藤", "近藤"]);
  });

  it("達成率が出る", () => {
    const row = apoRanking(
      core({ apo: { 安藤: 12 }, apoTargets: { 安藤: 15 } }),
    )[0];
    expect(row).toMatchObject({
      apoCount: 12,
      targetApoCount: 15,
      achievementRate: 80,
    });
  });

  it("目標が0なら達成率は0（総合PTと同じ扱い）", () => {
    const row = apoRanking(core({ apo: { 安藤: 12 } }))[0];
    expect(row).toMatchObject({
      targetApoCount: 0,
      achievementRate: 0,
    });
  });

  it("100%超はそのまま出す", () => {
    const row = apoRanking(
      core({ apo: { 安藤: 20 }, apoTargets: { 安藤: 15 } }),
    )[0];
    expect(row?.achievementRate).toBe(133.3);
  });

  it("順位は連番のまま付く", () => {
    const rows = apoRanking(core({ apoTargets: { 安藤: 10, 近藤: 30 } }));
    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
  });
});
