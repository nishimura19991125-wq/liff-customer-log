import { describe, expect, it } from "vitest";

import {
  aggregateSalesProgressByBranch,
  buildCompanySalesProgress,
  computeAchievement,
  formatSalesProgressNumber,
  formatSalesProgressRate,
  pickSelfSalesProgress,
  SALES_PROGRESS_UNASSIGNED_GROUP,
  sortSalesProgressStaffRows,
  summarizeSalesProgressMatching,
  type SalesActualRow,
  type SalesTargetRow,
} from "@/lib/sales-progress-aggregate";
import {
  resolveSalesProgressBranch,
  salesProgressBranchOrder,
  SALES_PROGRESS_DEFAULT_OTHER_BRANCH_LABEL,
  SALES_PROGRESS_DEFAULT_VISIBLE_BRANCHES,
} from "@/lib/sales-progress-branch";

const BRANCH_CONFIG = {
  visibleBranches: [...SALES_PROGRESS_DEFAULT_VISIBLE_BRANCHES],
  otherLabel: SALES_PROGRESS_DEFAULT_OTHER_BRANCH_LABEL,
};

function target(
  staffName: string,
  over: Partial<SalesTargetRow> = {},
): SalesTargetRow {
  return { staffName, branch: "奈良本社", apoCount: 10, pt: 1_000_000, ...over };
}

function actual(
  staffName: string,
  over: Partial<SalesActualRow> = {},
): SalesActualRow {
  return { staffName, apoCount: 5, pt: 500_000, ...over };
}

/** 並び替えの検証用。PT だけ動かし、アポは固定にする */
function buildMetrics(ptActual: number, ptTarget: number) {
  return {
    pt: computeAchievement(ptActual, ptTarget),
    apo: computeAchievement(0, 0),
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
    const m = computeAchievement(1_848_155, 1_350_000);
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
    actual("山田太郎", { pt: 500_000, apoCount: 4 }),
    actual("鈴木花子", { pt: 9_999_999, apoCount: 99 }),
  ];

  it("氏名で突合し、他人の数字が混ざらない", () => {
    const self = pickSelfSalesProgress(targets, actuals, "山田太郎");
    expect(self.metrics.pt.actual).toBe(500_000);
    expect(self.metrics.pt.target).toBe(1_000_000);
    expect(self.metrics.pt.ratePercent).toBe(50);
    expect(self.metrics.apo.actual).toBe(4);
    expect(self.metrics.apo.target).toBe(10);
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
    expect(self.metrics.apo.actual).toBe(0);
  });

  it("同じ人の目標行が複数あれば合算する", () => {
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
      [target("A", { pt: 1_000_000, apoCount: 10 })],
      [
        actual("A", { pt: 400_000, apoCount: 4 }),
        actual("B", { pt: 100_000, apoCount: 1 }),
      ],
    );
    expect(m.pt.actual).toBe(500_000);
    expect(m.pt.target).toBe(1_000_000);
    expect(m.pt.ratePercent).toBe(50);
    expect(m.apo.actual).toBe(5);
  });
});

describe("resolveSalesProgressBranch（支社の振り分け）", () => {
  it("表示対象の支社はそのまま", () => {
    expect(resolveSalesProgressBranch("奈良本社", BRANCH_CONFIG)).toBe("奈良本社");
    expect(resolveSalesProgressBranch("京都支社", BRANCH_CONFIG)).toBe("京都支社");
  });

  it("未設定・空白はその他", () => {
    expect(resolveSalesProgressBranch("", BRANCH_CONFIG)).toBe("その他");
    expect(resolveSalesProgressBranch("   ", BRANCH_CONFIG)).toBe("その他");
    expect(resolveSalesProgressBranch(undefined, BRANCH_CONFIG)).toBe("その他");
  });

  it("表示対象外の支社はその他", () => {
    for (const v of ["業務委託", "トラーチ倶楽部", "卸案件", "大阪支社"]) {
      expect(resolveSalesProgressBranch(v, BRANCH_CONFIG)).toBe("その他");
    }
  });

  it("全角半角・空白のゆれを吸収し、設定側の表記で返す", () => {
    expect(resolveSalesProgressBranch(" 奈良本社 ", BRANCH_CONFIG)).toBe("奈良本社");
    expect(resolveSalesProgressBranch("奈良 本社", BRANCH_CONFIG)).toBe("奈良本社");
  });

  it("表示順はその他を最後にする", () => {
    expect(salesProgressBranchOrder(BRANCH_CONFIG)).toEqual([
      "埼玉支社",
      "奈良本社",
      "名古屋支社",
      "京都支社",
      "その他",
    ]);
  });
});

describe("aggregateSalesProgressByBranch", () => {
  const targets = [
    target("A", { branch: "奈良本社", pt: 6_000_000, apoCount: 10 }),
    target("B", { branch: "奈良本社", pt: 4_800_000, apoCount: 10 }),
    target("C", { branch: "京都支社", pt: 3_000_000, apoCount: 5 }),
    target("D", { branch: "埼玉支社", pt: 2_000_000, apoCount: 5 }),
  ];
  const actuals = [
    actual("A", { pt: 1_000_000, apoCount: 3 }),
    actual("B", { pt: 694_490, apoCount: 2 }),
    actual("C", { pt: 900_000, apoCount: 1 }),
    actual("D", { pt: 100_000, apoCount: 1 }),
  ];
  const order = salesProgressBranchOrder(BRANCH_CONFIG);

  it("支社ごとに目標と実績を合算する", () => {
    const rows = aggregateSalesProgressByBranch(targets, actuals, {
      fallbackLabel: "その他",
      ensureLabels: order,
    });
    const nara = rows.find((r) => r.label === "奈良本社");
    expect(nara?.metrics.pt.target).toBe(10_800_000);
    expect(nara?.metrics.pt.actual).toBe(1_694_490);
    expect(nara?.metrics.pt.ratePercent).toBe(15.7);
    expect(nara?.memberCount).toBe(2);
  });

  it("データが無い支社も0の行として残り、並び順は固定される", () => {
    const rows = aggregateSalesProgressByBranch(targets, actuals, {
      fallbackLabel: "その他",
      ensureLabels: order,
    });
    expect(rows.map((r) => r.label)).toEqual(order);
    const nagoya = rows.find((r) => r.label === "名古屋支社");
    expect(nagoya?.metrics.pt.target).toBe(0);
    expect(nagoya?.metrics.pt.ratePercent).toBeNull();
  });

  it("目標が無い担当者の実績はその他に入る", () => {
    const rows = aggregateSalesProgressByBranch(
      targets,
      [...actuals, actual("謎の人", { pt: 777, apoCount: 1 })],
      { fallbackLabel: "その他", ensureLabels: order },
    );
    const other = rows.find((r) => r.label === "その他");
    expect(other?.metrics.pt.actual).toBe(777);
    expect(other?.metrics.pt.target).toBe(0);
    expect(other?.metrics.pt.ratePercent).toBeNull();
  });

  it("支社が空の目標行もその他に入れる（グループを捨てない）", () => {
    const rows = aggregateSalesProgressByBranch(
      [target("X", { branch: "", pt: 123 }), target("Y", { branch: "  ", pt: 1 })],
      [],
      { fallbackLabel: "その他", ensureLabels: order },
    );
    expect(rows.find((r) => r.label === "その他")?.metrics.pt.target).toBe(124);
  });

  it("★ 支社別の合計が全社合計と一致する（対象外・未設定を含む）", () => {
    // 表示対象外の支社と未設定を混ぜたうえで、目標の無い実績も足す
    const mixedTargets = [
      ...targets,
      target("E", { branch: resolveSalesProgressBranch("業務委託", BRANCH_CONFIG), pt: 500_000, apoCount: 2 }),
      target("F", { branch: resolveSalesProgressBranch("", BRANCH_CONFIG), pt: 300_000, apoCount: 1 }),
      target("G", { branch: resolveSalesProgressBranch("トラーチ倶楽部", BRANCH_CONFIG), pt: 200_000, apoCount: 1 }),
    ];
    const mixedActuals = [
      ...actuals,
      actual("E", { pt: 50_000, apoCount: 1 }),
      actual("F", { pt: 20_000, apoCount: 1 }),
      actual("目標の無い人", { pt: 9_000, apoCount: 3 }),
    ];

    const rows = aggregateSalesProgressByBranch(mixedTargets, mixedActuals, {
      fallbackLabel: "その他",
      ensureLabels: order,
    });
    const company = buildCompanySalesProgress(mixedTargets, mixedActuals);

    const sumTargetPt = rows.reduce((s, r) => s + r.metrics.pt.target, 0);
    const sumActualPt = rows.reduce((s, r) => s + r.metrics.pt.actual, 0);
    const sumTargetApo = rows.reduce((s, r) => s + r.metrics.apo.target, 0);
    const sumActualApo = rows.reduce((s, r) => s + r.metrics.apo.actual, 0);

    expect(sumTargetPt).toBe(company.pt.target);
    expect(sumActualPt).toBe(company.pt.actual);
    expect(sumTargetApo).toBe(company.apo.target);
    expect(sumActualApo).toBe(company.apo.actual);

    // 寄せ先が実際に効いていること（その他が空なら上の一致は自明になる）
    const other = rows.find((r) => r.label === "その他");
    expect(other?.metrics.pt.target).toBe(1_000_000);
    expect(other?.metrics.pt.actual).toBe(79_000);
  });

  it("突合できない行があっても他の支社の集計は壊れない", () => {
    const rows = aggregateSalesProgressByBranch(
      targets,
      [...actuals, actual("謎の人"), actual("", { pt: 500 })],
      { fallbackLabel: "その他", ensureLabels: order },
    );
    const nara = rows.find((r) => r.label === "奈良本社");
    expect(nara?.metrics.pt.actual).toBe(1_694_490);
    expect(nara?.metrics.pt.target).toBe(10_800_000);
  });

  it("並びの指定が無ければ目標の大きい順、寄せ先は最後", () => {
    const rows = aggregateSalesProgressByBranch(targets, actuals, {
      fallbackLabel: SALES_PROGRESS_UNASSIGNED_GROUP,
    });
    expect(rows.map((r) => r.label)).toEqual([
      "奈良本社",
      "京都支社",
      "埼玉支社",
    ]);
  });
});

describe("個人内訳（タスクL）", () => {
  const order = salesProgressBranchOrder(BRANCH_CONFIG);
  const targets = [
    target("山田太郎", { branch: "埼玉支社", pt: 2_000_000, apoCount: 8 }),
    target("佐藤花子", { branch: "埼玉支社", pt: 1_800_000, apoCount: 4 }),
    target("鈴木一郎", { branch: "埼玉支社", pt: 1_500_000, apoCount: 6 }),
  ];
  const actuals = [
    actual("山田太郎", { pt: 1_200_000, apoCount: 1 }),
    actual("佐藤花子", { pt: 494_490, apoCount: 9 }),
    // 鈴木一郎 は実績なし
  ];

  function saitama(t = targets, a = actuals) {
    const rows = aggregateSalesProgressByBranch(t, a, {
      fallbackLabel: "その他",
      ensureLabels: order,
    });
    return rows.find((r) => r.label === "埼玉支社")!;
  }

  it("担当者ごとの内訳を持ち、支社の合計と一致する", () => {
    const b = saitama();
    expect(b.members.map((m) => m.staffName)).toHaveLength(3);
    const sumActual = b.members.reduce((s, m) => s + m.metrics.pt.actual, 0);
    const sumTarget = b.members.reduce((s, m) => s + m.metrics.pt.target, 0);
    expect(sumActual).toBe(b.metrics.pt.actual);
    expect(sumTarget).toBe(b.metrics.pt.target);
  });

  it("既定の並びは PT 実績の降順", () => {
    expect(saitama().members.map((m) => m.staffName)).toEqual([
      "山田太郎",
      "佐藤花子",
      "鈴木一郎",
    ]);
  });

  it("実績が無い担当者も内訳に含まれ、達成率は数値で出る（目標があるため）", () => {
    const suzuki = saitama().members.find((m) => m.staffName === "鈴木一郎");
    expect(suzuki?.metrics.pt.actual).toBe(0);
    expect(suzuki?.metrics.pt.target).toBe(1_500_000);
    expect(suzuki?.metrics.pt.ratePercent).toBe(0);
  });

  it("目標未登録の担当者も内訳に含まれ、達成率は「—」", () => {
    const b = saitama(targets, [
      ...actuals,
      // 目標が無い＝目標行が無い人。支社が引けないので寄せ先に入る
      actual("高橋二郎", { pt: 300_000, apoCount: 2 }),
    ]);
    // 埼玉には入らない
    expect(b.members.map((m) => m.staffName)).not.toContain("高橋二郎");

    const rows = aggregateSalesProgressByBranch(
      targets,
      [...actuals, actual("高橋二郎", { pt: 300_000, apoCount: 2 })],
      { fallbackLabel: "その他", ensureLabels: order },
    );
    const other = rows.find((r) => r.label === "その他");
    const takahashi = other?.members.find((m) => m.staffName === "高橋二郎");
    expect(takahashi).toBeDefined();
    expect(takahashi?.metrics.pt.target).toBe(0);
    expect(takahashi?.metrics.pt.ratePercent).toBeNull();
    expect(formatSalesProgressRate(takahashi!.metrics.pt.ratePercent)).toBe("—");
  });

  it("同じ支社に目標だけの人と実績だけの人が混ざっても人数と一致する", () => {
    const b = saitama();
    expect(b.memberCount).toBe(b.members.length);
  });
});

describe("sortSalesProgressStaffRows（PT/アポの切り替え）", () => {
  const rows = aggregateSalesProgressByBranch(
    [
      target("山田太郎", { branch: "埼玉支社", pt: 2_000_000, apoCount: 8 }),
      target("佐藤花子", { branch: "埼玉支社", pt: 1_800_000, apoCount: 4 }),
    ],
    [
      actual("山田太郎", { pt: 1_200_000, apoCount: 1 }),
      actual("佐藤花子", { pt: 494_490, apoCount: 9 }),
    ],
    { fallbackLabel: "その他" },
  ).find((r) => r.label === "埼玉支社")!.members;

  it("PT を選ぶと PT 実績の降順", () => {
    expect(sortSalesProgressStaffRows(rows, "pt").map((m) => m.staffName)).toEqual([
      "山田太郎",
      "佐藤花子",
    ]);
  });

  it("アポを選ぶとアポ実績の降順に並び替わる", () => {
    expect(sortSalesProgressStaffRows(rows, "apo").map((m) => m.staffName)).toEqual([
      "佐藤花子",
      "山田太郎",
    ]);
  });

  it("切り替えで参照する値そのものが変わる", () => {
    const byApo = sortSalesProgressStaffRows(rows, "apo");
    expect(byApo[0]?.metrics.apo.actual).toBe(9);
    expect(byApo[0]?.metrics.pt.actual).toBe(494_490);
  });

  it("元の配列を書き換えない", () => {
    const before = rows.map((m) => m.staffName);
    sortSalesProgressStaffRows(rows, "apo");
    expect(rows.map((m) => m.staffName)).toEqual(before);
  });

  it("実績が同じときは目標の大きい順、それも同じなら氏名順で安定する", () => {
    // 漢字は照合順が環境で変わりうるので、順序が明確なカナで確かめる
    const same = [
      { staffName: "サトウ", metrics: buildMetrics(0, 100) },
      { staffName: "アオキ", metrics: buildMetrics(0, 100) },
      { staffName: "ヤマダ", metrics: buildMetrics(0, 300) },
    ];
    expect(sortSalesProgressStaffRows(same, "pt").map((m) => m.staffName)).toEqual([
      "ヤマダ",
      "アオキ",
      "サトウ",
    ]);
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
