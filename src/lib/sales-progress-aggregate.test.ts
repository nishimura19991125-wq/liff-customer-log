import { describe, expect, it } from "vitest";

import {
  aggregateSalesProgressByBranch,
  buildCompanySalesProgress,
  formatSalesProgressNumber,
  formatSalesProgressRate,
  sortSalesProgressStaffRows,
  type SalesActualRow,
  type SalesTargetRow,
} from "@/lib/sales-progress-aggregate";
import {
  parseSalesProgressVisibleBranches,
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
  return buildCompanySalesProgress(
    [target("並び替え", { pt: ptTarget, apoCount: 0 })],
    [actual("並び替え", { pt: ptActual, apoCount: 0 })],
  );
}

/**
 * 達成率の式。computeAchievement は非公開なので、合計を出す入口
 * （buildCompanySalesProgress）越しに検証する。目標・実績を1行ずつ渡せば
 * そのまま式へ届く。
 */
function rate(actualPt: number, targetPt: number) {
  return buildCompanySalesProgress(
    [target("山田太郎", { pt: targetPt })],
    [actual("山田太郎", { pt: actualPt })],
  ).pt;
}

describe("達成率の式", () => {
  it("達成率を小数第1位まで出す", () => {
    const m = rate(1_694_490, 10_800_000);
    expect(m.ratePercent).toBe(15.7);
    expect(m.barPercent).toBe(15.7);
  });

  it("目標が0のとき達成率は null（0除算を避ける）", () => {
    const m = rate(500, 0);
    expect(m.ratePercent).toBeNull();
    expect(m.barPercent).toBe(0);
    expect(m.actual).toBe(500);
  });

  it("目標が負・NaN でも null", () => {
    expect(rate(500, -1).ratePercent).toBeNull();
    expect(rate(500, Number.NaN).ratePercent).toBeNull();
  });

  it("100%超でもバーは振り切れず、数値はそのまま出す", () => {
    const m = rate(1_848_155, 1_350_000);
    expect(m.ratePercent).toBe(136.9);
    expect(m.barPercent).toBe(100);
  });

  it("実績0でも目標があれば 0.0%（「—」ではない）", () => {
    const m = rate(0, 1_000_000);
    expect(m.ratePercent).toBe(0);
    expect(m.barPercent).toBe(0);
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

});

describe("支社の表示順", () => {
  it("既定は 奈良本社 → 京都支社 → 名古屋支社 → 埼玉支社 → その他", () => {
    expect(salesProgressBranchOrder(BRANCH_CONFIG)).toEqual([
      "奈良本社",
      "京都支社",
      "名古屋支社",
      "埼玉支社",
      "その他",
    ]);
  });

  it("環境変数の並び順がそのまま表示順になる", () => {
    const config = {
      visibleBranches: parseSalesProgressVisibleBranches(
        "名古屋支社,埼玉支社,奈良本社,京都支社",
      ),
      otherLabel: SALES_PROGRESS_DEFAULT_OTHER_BRANCH_LABEL,
    };
    expect(salesProgressBranchOrder(config)).toEqual([
      "名古屋支社",
      "埼玉支社",
      "奈良本社",
      "京都支社",
      "その他",
    ]);
  });

  it("環境変数が未設定なら既定の並び順を使う", () => {
    expect(parseSalesProgressVisibleBranches(undefined)).toEqual([
      "奈良本社",
      "京都支社",
      "名古屋支社",
      "埼玉支社",
    ]);
    expect(parseSalesProgressVisibleBranches("")).toEqual([
      ...SALES_PROGRESS_DEFAULT_VISIBLE_BRANCHES,
    ]);
  });

  it("寄せ先は常に末尾。設定の途中に書かれていても動かさない", () => {
    const config = {
      visibleBranches: ["奈良本社", "その他", "京都支社"],
      otherLabel: "その他",
    };
    expect(salesProgressBranchOrder(config)).toEqual([
      "奈良本社",
      "京都支社",
      "その他",
    ]);
  });

  it("寄せ先の名前を変えても末尾に置く", () => {
    const config = { visibleBranches: ["奈良本社"], otherLabel: "他" };
    expect(salesProgressBranchOrder(config)).toEqual(["奈良本社", "他"]);
  });

  it("重複と空白だけの項目は取り除く", () => {
    const config = {
      visibleBranches: parseSalesProgressVisibleBranches(
        "奈良本社, 京都支社 ,奈良本社,  ,京都支社",
      ),
      otherLabel: "その他",
    };
    expect(salesProgressBranchOrder(config)).toEqual([
      "奈良本社",
      "京都支社",
      "その他",
    ]);
  });

  it("集計の行もこの順で並ぶ（実績の大小で並べ替えない）", () => {
    const order = salesProgressBranchOrder(BRANCH_CONFIG);
    const rows = aggregateSalesProgressByBranch(
      [
        // 実績・目標とも埼玉が最大。実績順なら先頭に来てしまう組み合わせ
        target("A", { branch: "埼玉支社", pt: 9_000_000 }),
        target("B", { branch: "奈良本社", pt: 1_000_000 }),
        target("C", { branch: "京都支社", pt: 2_000_000 }),
        target("D", { branch: "名古屋支社", pt: 3_000_000 }),
      ],
      [actual("A", { pt: 8_000_000 }), actual("B", { pt: 10 })],
      { fallbackLabel: "その他", ensureLabels: order },
    );
    expect(rows.map((r) => r.label)).toEqual([
      "奈良本社",
      "京都支社",
      "名古屋支社",
      "埼玉支社",
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
      fallbackLabel: "目標未登録",
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
