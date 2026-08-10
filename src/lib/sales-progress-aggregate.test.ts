import { describe, expect, it } from "vitest";

import {
  aggregateSalesProgressByGroup,
  buildCompanySalesProgress,
  computeAchievement,
  formatSalesProgressNumber,
  formatSalesProgressRate,
  pickSelfSalesProgress,
  SALES_PROGRESS_UNASSIGNED_GROUP,
  summarizeSalesProgressMatching,
  type SalesActualRow,
  type SalesTargetRow,
} from "@/lib/sales-progress-aggregate";

function target(
  staffName: string,
  over: Partial<SalesTargetRow> = {},
): SalesTargetRow {
  return {
    staffName,
    department: "営業部",
    branch: "奈良本社",
    apoCount: 10,
    pt: 1_000_000,
    contractCount: 5,
    ...over,
  };
}

function actual(
  staffName: string,
  over: Partial<SalesActualRow> = {},
): SalesActualRow {
  return {
    staffName,
    apoCount: 5,
    pt: 500_000,
    contractCount: 2,
    ...over,
  };
}

describe("computeAchievement", () => {
  it("達成率を小数第1位まで出す", () => {
    const m = computeAchievement(1_694_490, 10_800_000);
    expect(m.ratePercent).toBe(15.7);
    expect(m.barPercent).toBe(15.7);
  });

  it("目標が0のとき達成率は null（0除算を避ける）", () => {
    const m = computeAchievement(500, 0);
    expect(m.ratePercent).toBeNull();
    expect(m.barPercent).toBe(0);
    expect(m.actual).toBe(500);
  });

  it("目標が負・NaN でも null", () => {
    expect(computeAchievement(500, -1).ratePercent).toBeNull();
    expect(computeAchievement(500, Number.NaN).ratePercent).toBeNull();
  });

  it("100%超でもバーは振り切れず、数値はそのまま出す", () => {
    const m = computeAchievement(1_369_000, 1_000_000);
    expect(m.ratePercent).toBe(136.9);
    expect(m.barPercent).toBe(100);
  });

  it("実績0でも目標があれば 0.0%（「—」ではない）", () => {
    const m = computeAchievement(0, 1_000_000);
    expect(m.ratePercent).toBe(0);
    expect(m.barPercent).toBe(0);
  });
});

describe("pickSelfSalesProgress（本人分だけ）", () => {
  const targets = [target("山田太郎"), target("鈴木花子", { pt: 2_000_000 })];
  const actuals = [
    actual("山田太郎", { pt: 500_000 }),
    actual("鈴木花子", { pt: 9_999_999 }),
  ];

  it("氏名で突合し、他人の数字が混ざらない", () => {
    const self = pickSelfSalesProgress(targets, actuals, "山田太郎");
    expect(self.metrics.pt.actual).toBe(500_000);
    expect(self.metrics.pt.target).toBe(1_000_000);
    expect(self.metrics.pt.ratePercent).toBe(50);
    expect(self.targetMissing).toBe(false);
  });

  it("目標が無い人は実績だけ返り、達成率は「—」", () => {
    const self = pickSelfSalesProgress([], actuals, "山田太郎");
    expect(self.metrics.pt.actual).toBe(500_000);
    expect(self.metrics.pt.target).toBe(0);
    expect(self.metrics.pt.ratePercent).toBeNull();
    expect(self.targetMissing).toBe(true);
  });

  it("名簿に無い氏名を渡してもゼロで返る（他人の数字を返さない）", () => {
    const self = pickSelfSalesProgress(targets, actuals, "存在しない人");
    expect(self.metrics.pt.actual).toBe(0);
    expect(self.metrics.pt.target).toBe(0);
  });

  it("同じ人の目標行が複数月ぶんあれば合算する", () => {
    const self = pickSelfSalesProgress(
      [target("山田太郎", { pt: 100 }), target("山田太郎", { pt: 200 })],
      [],
      "山田太郎",
    );
    expect(self.metrics.pt.target).toBe(300);
  });
});

describe("buildCompanySalesProgress", () => {
  it("全社合計を出す", () => {
    const m = buildCompanySalesProgress(
      [target("A", { pt: 1_000_000, apoCount: 10, contractCount: 5 })],
      [
        actual("A", { pt: 400_000, apoCount: 4, contractCount: 1 }),
        actual("B", { pt: 100_000, apoCount: 1, contractCount: 1 }),
      ],
    );
    expect(m.pt.actual).toBe(500_000);
    expect(m.pt.target).toBe(1_000_000);
    expect(m.pt.ratePercent).toBe(50);
    expect(m.apo.actual).toBe(5);
    expect(m.contract.actual).toBe(2);
  });
});

describe("aggregateSalesProgressByGroup", () => {
  const targets = [
    target("A", { branch: "奈良本社", pt: 6_000_000 }),
    target("B", { branch: "奈良本社", pt: 4_800_000 }),
    target("C", { branch: "京都支社", pt: 3_000_000 }),
    target("D", { branch: "京都支社", pt: 2_000_000 }),
  ];
  const actuals = [
    actual("A", { pt: 1_000_000 }),
    actual("B", { pt: 694_490 }),
    actual("C", { pt: 900_000 }),
    actual("D", { pt: 100_000 }),
  ];

  it("支社ごとに目標と実績を合算する", () => {
    const rows = aggregateSalesProgressByGroup(targets, actuals, "branch");
    const nara = rows.find((r) => r.label === "奈良本社");
    expect(nara?.metrics?.pt.target).toBe(10_800_000);
    expect(nara?.metrics?.pt.actual).toBe(1_694_490);
    expect(nara?.metrics?.pt.ratePercent).toBe(15.7);
    expect(nara?.memberCount).toBe(2);
  });

  it("目標の大きい順に並ぶ", () => {
    const rows = aggregateSalesProgressByGroup(targets, actuals, "branch");
    expect(rows.map((r) => r.label)).toEqual(["奈良本社", "京都支社"]);
  });

  it("部署別でも同じように集計できる", () => {
    const rows = aggregateSalesProgressByGroup(
      [
        target("A", { department: "営業1課", pt: 100 }),
        target("B", { department: "営業1課", pt: 200 }),
        target("C", { department: "営業2課", pt: 50 }),
        target("D", { department: "営業2課", pt: 50 }),
      ],
      [actual("A", { pt: 10 }), actual("C", { pt: 5 })],
      "department",
    );
    expect(rows.find((r) => r.label === "営業1課")?.metrics?.pt).toMatchObject({
      target: 300,
      actual: 10,
    });
    expect(rows.find((r) => r.label === "営業2課")?.metrics?.pt).toMatchObject({
      target: 100,
      actual: 5,
    });
  });

  it("1人しかいないグループは数値を伏せる（実質的に個人の数字になるため）", () => {
    const rows = aggregateSalesProgressByGroup(
      [target("A", { branch: "単独支社" }), ...targets],
      [actual("A"), ...actuals],
      "branch",
    );
    const solo = rows.find((r) => r.label === "単独支社");
    expect(solo?.memberCount).toBe(1);
    expect(solo?.suppressed).toBe(true);
    expect(solo?.metrics).toBeNull();
  });

  it("しきい値は差し替えられる", () => {
    const rows = aggregateSalesProgressByGroup(
      [target("A", { branch: "単独支社" })],
      [actual("A")],
      "branch",
      { minGroupMembers: 1 },
    );
    expect(rows[0]?.suppressed).toBe(false);
    expect(rows[0]?.metrics).not.toBeNull();
  });

  it("目標の無い実績は目標未登録にまとめ、全社合計と食い違わせない", () => {
    const rows = aggregateSalesProgressByGroup(
      targets,
      [...actuals, actual("E", { pt: 777 }), actual("F", { pt: 111 })],
      "branch",
      { minGroupMembers: 1 },
    );
    const unassigned = rows.find(
      (r) => r.label === SALES_PROGRESS_UNASSIGNED_GROUP,
    );
    expect(unassigned?.metrics?.pt.actual).toBe(888);
    expect(unassigned?.metrics?.pt.target).toBe(0);
    expect(unassigned?.metrics?.pt.ratePercent).toBeNull();

    // 部署別の実績合計＝全社の実績合計
    const sum = rows.reduce((s, r) => s + (r.metrics?.pt.actual ?? 0), 0);
    const company = buildCompanySalesProgress(targets, [
      ...actuals,
      actual("E", { pt: 777 }),
      actual("F", { pt: 111 }),
    ]);
    expect(sum).toBe(company.pt.actual);
  });

  it("目標未登録は常に末尾に置く", () => {
    const rows = aggregateSalesProgressByGroup(
      targets,
      [...actuals, actual("E", { pt: 99_999_999 }), actual("F")],
      "branch",
      { minGroupMembers: 1 },
    );
    expect(rows[rows.length - 1]?.label).toBe(SALES_PROGRESS_UNASSIGNED_GROUP);
  });

  it("突合できない行があっても他のグループの集計は壊れない", () => {
    const rows = aggregateSalesProgressByGroup(
      targets,
      [...actuals, actual("謎の人"), actual("", { pt: 500 })],
      "branch",
    );
    const nara = rows.find((r) => r.label === "奈良本社");
    expect(nara?.metrics?.pt.actual).toBe(1_694_490);
    expect(nara?.metrics?.pt.target).toBe(10_800_000);
  });

  it("支社が空の目標行は目標未登録に入れる（グループを捨てない）", () => {
    const rows = aggregateSalesProgressByGroup(
      [target("A", { branch: "  " , pt: 123 }), target("B", { branch: "", pt: 1 })],
      [],
      "branch",
      { minGroupMembers: 1 },
    );
    expect(rows[0]?.label).toBe(SALES_PROGRESS_UNASSIGNED_GROUP);
    expect(rows[0]?.metrics?.pt.target).toBe(124);
  });
});

describe("summarizeSalesProgressMatching", () => {
  it("突合できなかった人数を数える（氏名は返さない）", () => {
    const s = summarizeSalesProgressMatching(
      [target("山田太郎"), target("鈴木花子"), target("佐藤一郎")],
      [actual("山田太郎"), actual("高橋二郎"), actual("田中三郎")],
      { targetRowsWithoutName: 2, actualRowsWithoutName: 1 },
    );
    expect(s.targetsWithoutActual).toBe(2); // 鈴木花子・佐藤一郎
    expect(s.actualsWithoutTarget).toBe(2); // 高橋二郎・田中三郎
    expect(s.targetRowsWithoutName).toBe(2);
    expect(s.actualRowsWithoutName).toBe(1);
    // 件数だけを返し、氏名そのものは載せない
    const json = JSON.stringify(s);
    for (const name of ["山田", "鈴木", "佐藤", "高橋", "田中"]) {
      expect(json).not.toContain(name);
    }
  });

  it("同じ人が複数行あっても人数として1回だけ数える", () => {
    const s = summarizeSalesProgressMatching(
      [target("山田太郎"), target("山田太郎")],
      [actual("高橋二郎"), actual("高橋二郎")],
    );
    expect(s.targetsWithoutActual).toBe(1);
    expect(s.actualsWithoutTarget).toBe(1);
  });
});

describe("表示の整形", () => {
  it("3桁区切り", () => {
    expect(formatSalesProgressNumber(1_694_490)).toBe("1,694,490");
    expect(formatSalesProgressNumber(0)).toBe("0");
  });

  it("達成率は小数第1位まで。null は「—」", () => {
    expect(formatSalesProgressRate(15.7)).toBe("15.7%");
    expect(formatSalesProgressRate(136.9)).toBe("136.9%");
    expect(formatSalesProgressRate(100)).toBe("100.0%");
    expect(formatSalesProgressRate(null)).toBe("—");
  });
});
