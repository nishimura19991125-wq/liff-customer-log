import "server-only";

import {
  aggregateSalesProgressByBranch,
  buildCompanySalesProgress,
  type SalesActualRow,
  type SalesProgressGroupRow,
  type SalesProgressMetrics,
  type SalesTargetRow,
} from "@/lib/sales-progress-aggregate";
import {
  resolveSalesProgressBranch,
  salesProgressBranchOrder,
  type SalesProgressBranchConfig,
} from "@/lib/sales-progress-branch";
import {
  latestTargetBranchByStaff,
  type SalesDashboardTargetLookup,
} from "@/lib/sales-dashboard-target-lookup";

/**
 * 営業ランキングの「全体の進捗」「支社別」。
 *
 * ■ 計算式は作り直さない
 * 合計・達成率・支社別の積み上げは **sales-progress-aggregate.ts の
 * buildCompanySalesProgress / aggregateSalesProgressByBranch をそのまま呼ぶ**。
 * かつての営業進捗（削除済み）と同じ数字になることが要件だったので、
 * ここで式を持たない。式を触るなら向こうのファイルとテストを直す。
 * このファイルがやるのは「月別に積んだ集計から、その月ぶんの目標行・実績行を
 * 組み立てて渡す」ことだけ。
 *
 * ■ 支社の決め方（判断済み事項①）
 * 目標アプリの「支社」列を優先し、**値が空なら名簿の勤務場所**へ落とす。
 * どちらも resolveSalesProgressBranch に通してから使う。名簿の生値をそのまま
 * 使うと表記ゆれ（全角半角・空白）で見出しが分裂するため。
 * 削除した営業進捗の集計とは数字が変わる（目標未登録の人が「その他」から
 * 実支社へ移る）。これは意図した改善。
 *
 * ■ 目標が無い人を捨てない
 * aggregateSalesProgressByBranch は「担当者→支社」を**目標行からしか作らない**。
 * 目標が無い人の実績は寄せ先（その他）へ落ちてしまう。そこで、実績はあるが
 * 目標行が無い人には **目標 0 の行を足してから渡す**。合計は 0 を足すだけで
 * 変わらず、支社だけが伝わる。こうすると支社別の合計は全社合計と一致した
 * まま、その人が実支社の行に入る。
 */

export type SalesDashboardProgress = {
  company: SalesProgressMetrics;
  branches: SalesProgressGroupRow[];
  /** 対象期間の目標が1件も無い（達成率が全部「—」になる） */
  targetsAvailable: boolean;
};

export type SalesDashboardProgressInput = {
  /** 集計する月。1件なら単月、12件なら年度累計 */
  ymKeys: readonly string[];
  targets: SalesDashboardTargetLookup;
  /** 正規化担当者名 → 対象期間の PT 実績 */
  ptActualByStaff: Map<string, number>;
  /** 正規化担当者名 → 対象期間のアポ件数 */
  apoActualByStaff: Map<string, number>;
  /** 正規化担当者名 → スタッフ名簿の勤務場所（生値）。目標の支社が空のとき使う */
  rosterBranchByStaff: Map<string, string>;
  branchConfig: SalesProgressBranchConfig;
};

export function buildSalesDashboardProgress(
  input: SalesDashboardProgressInput,
): SalesDashboardProgress {
  const {
    ymKeys,
    targets,
    ptActualByStaff,
    apoActualByStaff,
    rosterBranchByStaff,
    branchConfig,
  } = input;

  const targetBranchRawByStaff = latestTargetBranchByStaff(targets);

  /** ①の順序。目標アプリの支社 → 名簿の勤務場所 → その他 */
  const branchOf = (name: string): string => {
    const raw =
      targetBranchRawByStaff.get(name)?.trim() ||
      rosterBranchByStaff.get(name)?.trim() ||
      "";
    return resolveSalesProgressBranch(raw, branchConfig);
  };

  const targetRows: SalesTargetRow[] = [];
  const namesWithTarget = new Set<string>();

  targets.byStaffMonth.forEach((byMonth, name) => {
    let pt = 0;
    let apoCount = 0;
    let found = false;
    for (const ymKey of ymKeys) {
      const hit = byMonth.get(ymKey);
      if (!hit) continue;
      found = true;
      pt += hit.pt;
      apoCount += hit.apoCount;
    }
    // 対象期間に行が無い人は数えない（人数が水増しされる）
    if (!found) return;
    namesWithTarget.add(name);
    targetRows.push({ staffName: name, branch: branchOf(name), apoCount, pt });
  });

  const actualRows: SalesActualRow[] = [];
  const actualNames = new Set<string>([
    ...ptActualByStaff.keys(),
    ...apoActualByStaff.keys(),
  ]);
  for (const name of actualNames) {
    actualRows.push({
      staffName: name,
      pt: ptActualByStaff.get(name) ?? 0,
      apoCount: apoActualByStaff.get(name) ?? 0,
    });
    // 目標が無い人にも支社を伝える。合計は 0 を足すだけなので変わらない
    if (!namesWithTarget.has(name)) {
      targetRows.push({
        staffName: name,
        branch: branchOf(name),
        apoCount: 0,
        pt: 0,
      });
    }
  }

  return {
    company: buildCompanySalesProgress(targetRows, actualRows),
    branches: aggregateSalesProgressByBranch(targetRows, actualRows, {
      fallbackLabel: branchConfig.otherLabel,
      ensureLabels: salesProgressBranchOrder(branchConfig),
    }),
    targetsAvailable: namesWithTarget.size > 0,
  };
}
