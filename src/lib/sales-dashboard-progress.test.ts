import { describe, expect, it } from "vitest";

import { buildSalesDashboardProgress } from "@/lib/sales-dashboard-progress";
import type { SalesDashboardTargetLookup } from "@/lib/sales-dashboard-target-lookup";
import type { SalesProgressBranchConfig } from "@/lib/sales-progress-branch";

const BRANCH_CONFIG: SalesProgressBranchConfig = {
  visibleBranches: ["奈良本社", "京都支社"],
  otherLabel: "その他",
};

function targets(
  rows: Array<{
    name: string;
    ym: string;
    pt?: number;
    apoCount?: number;
    branchRaw?: string;
  }>,
): SalesDashboardTargetLookup {
  const byStaffMonth = new Map<
    string,
    Map<string, { pt: number; apoCount: number; branchRaw: string }>
  >();
  for (const r of rows) {
    let byMonth = byStaffMonth.get(r.name);
    if (!byMonth) {
      byMonth = new Map();
      byStaffMonth.set(r.name, byMonth);
    }
    byMonth.set(r.ym, {
      pt: r.pt ?? 0,
      apoCount: r.apoCount ?? 0,
      branchRaw: r.branchRaw ?? "",
    });
  }
  return { byStaffMonth, available: rows.length > 0 };
}

/** 支社の合計が全社合計と一致するか（捨てていないことの確認） */
function branchSum(
  branches: ReturnType<typeof buildSalesDashboardProgress>["branches"],
  metric: "pt" | "apo",
  field: "actual" | "target",
): number {
  return branches.reduce((s, b) => s + b.metrics[metric][field], 0);
}

describe("★ 全体の進捗", () => {
  it("実績と目標の総和から達成率を出す", () => {
    const p = buildSalesDashboardProgress({
      ymKeys: ["2026-09"],
      targets: targets([
        { name: "山田", ym: "2026-09", pt: 1000, apoCount: 10, branchRaw: "奈良本社" },
        { name: "田中", ym: "2026-09", pt: 1000, apoCount: 10, branchRaw: "京都支社" },
      ]),
      ptActualByStaff: new Map([
        ["山田", 800],
        ["田中", 400],
      ]),
      apoActualByStaff: new Map([
        ["山田", 12],
        ["田中", 6],
      ]),
      rosterBranchByStaff: new Map(),
      branchConfig: BRANCH_CONFIG,
    });

    expect(p.company.pt).toMatchObject({
      actual: 1200,
      target: 2000,
      ratePercent: 60,
    });
    expect(p.company.apo).toMatchObject({
      actual: 18,
      target: 20,
      ratePercent: 90,
    });
  });

  it("年度の累計は12ヶ月を足す", () => {
    const p = buildSalesDashboardProgress({
      ymKeys: ["2026-03", "2026-04", "2026-05"],
      targets: targets([
        { name: "山田", ym: "2026-03", pt: 100, branchRaw: "奈良本社" },
        { name: "山田", ym: "2026-04", pt: 200, branchRaw: "奈良本社" },
        { name: "山田", ym: "2026-05", pt: 300, branchRaw: "奈良本社" },
        // 範囲外の月は足さない
        { name: "山田", ym: "2026-06", pt: 999, branchRaw: "奈良本社" },
      ]),
      ptActualByStaff: new Map([["山田", 540]]),
      apoActualByStaff: new Map(),
      rosterBranchByStaff: new Map(),
      branchConfig: BRANCH_CONFIG,
    });

    expect(p.company.pt.target).toBe(600);
    expect(p.company.pt.actual).toBe(540);
    expect(p.company.pt.ratePercent).toBe(90);
  });

  it("目標が無ければ達成率は null（画面は「—」）", () => {
    const p = buildSalesDashboardProgress({
      ymKeys: ["2026-09"],
      targets: targets([]),
      ptActualByStaff: new Map([["山田", 800]]),
      apoActualByStaff: new Map(),
      rosterBranchByStaff: new Map(),
      branchConfig: BRANCH_CONFIG,
    });

    expect(p.company.pt.ratePercent).toBeNull();
    expect(p.company.pt.actual).toBe(800);
    expect(p.targetsAvailable).toBe(false);
  });
});

describe("★ 支社別", () => {
  it("設定した支社が並び、最後がその他", () => {
    const p = buildSalesDashboardProgress({
      ymKeys: ["2026-09"],
      targets: targets([
        { name: "山田", ym: "2026-09", pt: 100, branchRaw: "奈良本社" },
      ]),
      ptActualByStaff: new Map([["山田", 50]]),
      apoActualByStaff: new Map(),
      rosterBranchByStaff: new Map(),
      branchConfig: BRANCH_CONFIG,
    });

    expect(p.branches.map((b) => b.label)).toEqual([
      "奈良本社",
      "京都支社",
      "その他",
    ]);
  });

  it("支社の下に個人が入る", () => {
    const p = buildSalesDashboardProgress({
      ymKeys: ["2026-09"],
      targets: targets([
        { name: "山田", ym: "2026-09", pt: 100, branchRaw: "奈良本社" },
        { name: "佐藤", ym: "2026-09", pt: 200, branchRaw: "奈良本社" },
      ]),
      ptActualByStaff: new Map([
        ["山田", 50],
        ["佐藤", 300],
      ]),
      apoActualByStaff: new Map(),
      rosterBranchByStaff: new Map(),
      branchConfig: BRANCH_CONFIG,
    });

    const nara = p.branches.find((b) => b.label === "奈良本社");
    expect(nara?.memberCount).toBe(2);
    // 既定は PT 実績の降順
    expect(nara?.members.map((m) => m.staffName)).toEqual(["佐藤", "山田"]);
    expect(nara?.metrics.pt).toMatchObject({ actual: 350, target: 300 });
  });

  it("支社別の合計は全社合計と一致する", () => {
    const p = buildSalesDashboardProgress({
      ymKeys: ["2026-09"],
      targets: targets([
        { name: "山田", ym: "2026-09", pt: 100, apoCount: 3, branchRaw: "奈良本社" },
        { name: "佐藤", ym: "2026-09", pt: 200, apoCount: 4, branchRaw: "謎の支社" },
      ]),
      ptActualByStaff: new Map([
        ["山田", 50],
        ["佐藤", 300],
        // 目標も支社も無い人
        ["新人", 70],
      ]),
      apoActualByStaff: new Map([["新人", 5]]),
      rosterBranchByStaff: new Map(),
      branchConfig: BRANCH_CONFIG,
    });

    expect(branchSum(p.branches, "pt", "actual")).toBe(p.company.pt.actual);
    expect(branchSum(p.branches, "pt", "target")).toBe(p.company.pt.target);
    expect(branchSum(p.branches, "apo", "actual")).toBe(p.company.apo.actual);
    expect(branchSum(p.branches, "apo", "target")).toBe(p.company.apo.target);
  });
});

describe("★ 支社の決め方（目標アプリ優先・名簿へフォールバック）", () => {
  it("目標アプリの支社を使う", () => {
    const p = buildSalesDashboardProgress({
      ymKeys: ["2026-09"],
      targets: targets([
        { name: "山田", ym: "2026-09", pt: 100, branchRaw: "奈良本社" },
      ]),
      ptActualByStaff: new Map([["山田", 50]]),
      apoActualByStaff: new Map(),
      // 名簿は違う支社。目標アプリが優先される
      rosterBranchByStaff: new Map([["山田", "京都支社"]]),
      branchConfig: BRANCH_CONFIG,
    });

    const nara = p.branches.find((b) => b.label === "奈良本社");
    expect(nara?.members.map((m) => m.staffName)).toEqual(["山田"]);
  });

  it("目標アプリの支社が空なら名簿の勤務場所へ落ちる", () => {
    const p = buildSalesDashboardProgress({
      ymKeys: ["2026-09"],
      targets: targets([{ name: "山田", ym: "2026-09", pt: 100 }]),
      ptActualByStaff: new Map([["山田", 50]]),
      apoActualByStaff: new Map(),
      rosterBranchByStaff: new Map([["山田", "京都支社"]]),
      branchConfig: BRANCH_CONFIG,
    });

    const kyoto = p.branches.find((b) => b.label === "京都支社");
    expect(kyoto?.members.map((m) => m.staffName)).toEqual(["山田"]);
  });

  it("名簿の値も正規化する（表記ゆれで見出しが割れない）", () => {
    const p = buildSalesDashboardProgress({
      ymKeys: ["2026-09"],
      targets: targets([{ name: "山田", ym: "2026-09", pt: 100 }]),
      ptActualByStaff: new Map([["山田", 50]]),
      apoActualByStaff: new Map(),
      // 全角空白まじり
      rosterBranchByStaff: new Map([["山田", " 京都　支社 "]]),
      branchConfig: BRANCH_CONFIG,
    });

    expect(p.branches.map((b) => b.label)).toEqual([
      "奈良本社",
      "京都支社",
      "その他",
    ]);
    const kyoto = p.branches.find((b) => b.label === "京都支社");
    expect(kyoto?.members.map((m) => m.staffName)).toEqual(["山田"]);
  });

  it("どちらも無ければその他へ寄せる", () => {
    const p = buildSalesDashboardProgress({
      ymKeys: ["2026-09"],
      targets: targets([{ name: "山田", ym: "2026-09", pt: 100 }]),
      ptActualByStaff: new Map([["山田", 50]]),
      apoActualByStaff: new Map(),
      rosterBranchByStaff: new Map(),
      branchConfig: BRANCH_CONFIG,
    });

    const other = p.branches.find((b) => b.label === "その他");
    expect(other?.members.map((m) => m.staffName)).toEqual(["山田"]);
  });
});

describe("★ 目標が未設定の人を捨てない", () => {
  it("実績だけの人も支社の行に入る（名簿の支社を使う）", () => {
    const p = buildSalesDashboardProgress({
      ymKeys: ["2026-09"],
      targets: targets([
        { name: "山田", ym: "2026-09", pt: 100, branchRaw: "奈良本社" },
      ]),
      ptActualByStaff: new Map([
        ["山田", 50],
        ["新人", 70],
      ]),
      apoActualByStaff: new Map(),
      rosterBranchByStaff: new Map([["新人", "京都支社"]]),
      branchConfig: BRANCH_CONFIG,
    });

    const kyoto = p.branches.find((b) => b.label === "京都支社");
    expect(kyoto?.members.map((m) => m.staffName)).toEqual(["新人"]);
    expect(kyoto?.metrics.pt).toMatchObject({
      actual: 70,
      target: 0,
      ratePercent: null,
    });
  });

  it("目標0の行を足しても全社の目標は増えない", () => {
    const p = buildSalesDashboardProgress({
      ymKeys: ["2026-09"],
      targets: targets([
        { name: "山田", ym: "2026-09", pt: 100, branchRaw: "奈良本社" },
      ]),
      ptActualByStaff: new Map([
        ["山田", 50],
        ["新人", 70],
      ]),
      apoActualByStaff: new Map(),
      rosterBranchByStaff: new Map([["新人", "京都支社"]]),
      branchConfig: BRANCH_CONFIG,
    });

    expect(p.company.pt.target).toBe(100);
    expect(p.company.pt.actual).toBe(120);
  });

  it("対象期間に目標行が無い人は人数に数えない", () => {
    const p = buildSalesDashboardProgress({
      ymKeys: ["2026-09"],
      targets: targets([
        // 別の月にしか目標が無く、9月の実績も無い
        { name: "退職者", ym: "2026-04", pt: 500, branchRaw: "奈良本社" },
        { name: "山田", ym: "2026-09", pt: 100, branchRaw: "奈良本社" },
      ]),
      ptActualByStaff: new Map([["山田", 50]]),
      apoActualByStaff: new Map(),
      rosterBranchByStaff: new Map(),
      branchConfig: BRANCH_CONFIG,
    });

    const nara = p.branches.find((b) => b.label === "奈良本社");
    expect(nara?.memberCount).toBe(1);
    expect(p.company.pt.target).toBe(100);
  });
});
