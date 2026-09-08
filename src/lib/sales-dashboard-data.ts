import "server-only";

import { fetchAppFields } from "@/lib/atpocket";
import {
  customerInfoDashboardFieldAuth,
  customerInfoDashboardListAuths,
} from "@/lib/customer-info-config";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { readCustomerInfoFieldValue } from "@/lib/customer-info-record";
import type {
  ApoDashboardKpi,
  ApoDashboardRankingRow,
} from "@/lib/sales-dashboard-apo-aggregate";
import { isCustomerStatusCancelledExact } from "@/lib/customer-status-label";
import {
  aggregateCustomerInfoPt,
  resolveCustomerInfoPtFieldMap,
  sumCustomerPtMonths,
  type CustomerInfoPtFieldMap,
  type CustomerPtMonthlyAgg,
  type PtBreakdownRow,
} from "@/lib/sales-dashboard-customer-pt";
import {
  buildApoAndTenkaMonthly,
  buildTenkaRanking,
  sortTenkaAgg,
} from "@/lib/sales-dashboard-apo-tenka-bundle";
import {
  buildApoRanking,
  pickApoMonth,
  sortApoAgg,
  sumApoMonths,
  type ApoMonthlyAgg,
} from "@/lib/sales-dashboard-apo-aggregate";
import {
  pickTenkaMonth,
  sumTenkaMonths,
  type TenkaMonthlyAgg,
} from "@/lib/sales-dashboard-tenka-aggregate";
import {
  resolveContractCountFieldMap,
  salesDashboardApoAppId,
  salesDashboardContractAppId,
} from "@/lib/sales-dashboard-fields";
import { achievementRate } from "@/lib/sales-dashboard-achievement";
import { sortByPtThenTarget } from "@/lib/sales-dashboard-ranking-sort";
import { fetchSalesDashboardRecordPages } from "@/lib/sales-dashboard-list-fetch";
import {
  fetchSalesDashboardPtTargets,
  pickTargetPtByStaff,
  sumTargetPtByStaff,
  type SalesDashboardTargetLookup,
} from "@/lib/sales-dashboard-target-lookup";
import {
  buildSalesDashboardProgress,
  type SalesDashboardProgress,
} from "@/lib/sales-dashboard-progress";
import { salesProgressBranchConfig } from "@/lib/sales-target-fields";
import type { SalesProgressMetrics } from "@/lib/sales-progress-aggregate";
import {
  FISCAL_ANNUAL_MONTH_KEY,
  buildFiscalMonthOptions,
  currentYmInJst,
  fiscalYearMonths,
  type FiscalMonthSelection,
} from "@/lib/fiscal-year";
import {
  lookupStaffWorkplaceByStaffName,
  resolveStaffWorkplaceLookupConfig,
} from "@/lib/staff-workplace-lookup";
import { isExcludedSalesDashboardRankingName } from "@/lib/sales-dashboard-ranking-exclude";
import { parseSalesDashboardRecordYmFromField } from "@/lib/sales-dashboard-record-date";

export type { ApoDashboardKpi, ApoDashboardRankingRow };

export type SalesDashboardKpi = {
  pt: number;
  contractCount: number;
};

export type SalesDashboardRankingRow = {
  rank: number;
  staffName: string;
  pt: number;
  contractCount: number;
  sharePercent: number;
  isSelf: boolean;
  isPodium: boolean;
  /** 目標登録(月次)の PT 目標。未設定・取得不可は 0 */
  targetPt: number;
  /** 達成率(%)。targetPt <= 0 のときは 0 */
  achievementRate: number;
  /** スタッフ名簿の勤務場所（所属支社）。引けなければ空文字 */
  branch: string;
};

export type { PtBreakdownRow };

/** 支社別の内訳1人分。isSelf はキャッシュに入れず personalize で付ける */
export type SalesDashboardProgressMember = {
  staffName: string;
  isSelf: boolean;
  metrics: SalesProgressMetrics;
};

export type SalesDashboardProgressBranch = {
  label: string;
  memberCount: number;
  metrics: SalesProgressMetrics;
  members: SalesDashboardProgressMember[];
};

/** 「全体の進捗」と「支社別」。部門タブは画面側が pt / apo を選ぶ */
export type SalesDashboardProgressPayload = {
  company: SalesProgressMetrics;
  branches: SalesDashboardProgressBranch[];
  targetsAvailable: boolean;
};

export type SalesDashboardPayload = {
  staffName: string;
  periodLabel: string;
  periodHint: string;
  /** 選択中の年度 */
  fiscalYear: { key: string; startYear: number; label: string };
  /** 選べる年度（今年度・前年度） */
  fiscalYearOptions: Array<{ key: string; label: string }>;
  /** 選べる月（3〜2月の12ヶ月＋「年間」） */
  monthOptions: Array<{ key: string; label: string }>;
  /** 選択中の月。YYYY-MM か "annual" */
  selectedMonth: string;
  selectedMonthLabel: string;
  /** 選択中の期間の全体・支社別 */
  progress: SalesDashboardProgressPayload;
  /** その年度の累計。選択が「年間」なら progress と同じ中身 */
  annualProgress: SalesDashboardProgressPayload;
  kpi: SalesDashboardKpi;
  ranking: SalesDashboardRankingRow[];
  /** 正規化担当者名 → 期間内 PT 明細（全員閲覧可） */
  ptBreakdownByStaff: Record<string, PtBreakdownRow[]>;
  apoEnabled: boolean;
  apoReady: boolean;
  apoError: string | null;
  apoKpi: ApoDashboardKpi | null;
  apoRanking: ApoDashboardRankingRow[];
  tenkaReady: boolean;
  tenkaError: string | null;
  tenkaKpi: { totalTargetCount: number } | null;
  tenkaRanking: ApoDashboardRankingRow[];
  /** 429 時にサーバー共有キャッシュの古い集計を返したとき */
  rateLimited?: boolean;
  dashboardStale?: boolean;
};

type StaffAgg = {
  name: string;
  pt: number;
  contractCount: number;
};

function monthKeyFromYm(year: number, month1: number): string {
  return `${year}-${String(month1).padStart(2, "0")}`;
}

/** 担当者名 → 年月（YYYY-MM）→ その月の PT 実績 */
/**
 * 契約情報: 担当者ごと・年月ごとの契約件数。
 *
 * CL担当者は総合PTと同じ列（CUSTOMER_INFO_FIELD_CL_STAFF）から取る。
 * キャンセルの判定も総合PTと同じ isCustomerStatusCancelledExact に寄せた。
 * 以前は生の完全一致で、全角空白などの表記ゆれを取りこぼしていた。
 */
function buildContractCountByMonth(
  records: Array<{ record?: unknown }>,
  fieldMap: CustomerInfoPtFieldMap,
): Map<string, Map<string, number>> {
  const map = new Map<string, Map<string, number>>();

  for (const row of records) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const recObj = rec as Record<string, unknown>;

    if (fieldMap.customerStatus) {
      const status = readCustomerInfoFieldValue(
        recObj,
        fieldMap.customerStatus,
      );
      if (isCustomerStatusCancelledExact(status)) continue;
    }

    const name = normApClStaffName(
      readCustomerInfoFieldValue(recObj, fieldMap.clStaff),
    );
    if (!name || isExcludedSalesDashboardRankingName(name)) continue;

    const ym = parseSalesDashboardRecordYmFromField(recObj, fieldMap.date);
    if (!ym) continue;

    const monthKey = monthKeyFromYm(ym.year, ym.month1);
    let perPerson = map.get(name);
    if (!perPerson) {
      perPerson = new Map();
      map.set(name, perPerson);
    }
    perPerson.set(monthKey, (perPerson.get(monthKey) ?? 0) + 1);
  }

  return map;
}

function mergeContractCounts(
  byStaff: Map<string, StaffAgg>,
  contractMap: Map<string, Map<string, number>>,
  ymKeys: readonly string[],
): void {
  contractMap.forEach((perMonth, name) => {
    let count = 0;
    for (const ymKey of ymKeys) count += perMonth.get(ymKey) ?? 0;
    if (count <= 0) return;
    const cur = byStaff.get(name) ?? { name, pt: 0, contractCount: 0 };
    cur.contractCount = count;
    byStaff.set(name, cur);
  });
}

/**
 * ランキング対象外の担当者を落としてから、PT → 目標 → 氏名 の順に並べる。
 * 並びの規則そのものは sales-dashboard-ranking-sort.ts に置いてある。
 */
function sortStaffAgg(
  items: StaffAgg[],
  targetPtByStaff: Map<string, number>,
): StaffAgg[] {
  const visible = items.filter(
    (it) => !isExcludedSalesDashboardRankingName(it.name),
  );
  return sortByPtThenTarget(visible, targetPtByStaff);
}

/**
 * 正規化担当者名 → 勤務場所（所属支社）。
 *
 * スタッフ名簿は既にこのリクエストで読んでいる（route が
 * resolveBoundStaffNameForLineUser を通す）。**レコード取得は増えない。**
 * 突合も同じ normApClStaffName で、新しい判定は足していない。
 *
 * 引けなくても集計は続ける（支社は付加情報）。
 */
async function resolveBranchByStaff(
  names: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const cfg = await resolveStaffWorkplaceLookupConfig();
    if (!cfg) return out;
    const found = await Promise.all(
      names.map((name) => lookupStaffWorkplaceByStaffName(name, cfg)),
    );
    names.forEach((name, i) => {
      const branch = found[i]?.trim();
      if (branch) out.set(name, branch);
    });
  } catch (e) {
    console.warn(
      "[sales-dashboard] 所属支社を引けませんでした（支社は表示しません）",
      e instanceof Error ? e.message : String(e),
    );
  }
  return out;
}

function buildRanking(
  sorted: StaffAgg[],
  companyPt: number,
  bound: string,
  /** 正規化担当者名 → PT 目標。引けない担当者は 0 になる */
  targetPtByStaff: Map<string, number>,
  /** 正規化担当者名 → 所属支社。引けない担当者は空文字になる */
  branchByStaff: Map<string, string>,
): SalesDashboardRankingRow[] {
  return sorted.map((item, i) => {
    const targetPt = targetPtByStaff.get(item.name) ?? 0;
    return {
      rank: i + 1,
      staffName: item.name,
      pt: item.pt,
      contractCount: item.contractCount,
      sharePercent:
        companyPt > 0 ? Math.round((item.pt / companyPt) * 1000) / 10 : 0,
      isSelf: normApClStaffName(item.name) === bound,
      isPodium: i < 3,
      targetPt,
      achievementRate: achievementRate(item.pt, targetPt),
      branch: branchByStaff.get(item.name) ?? "",
    };
  });
}

/**
 * 目標が引けなかった担当者の数を残す。**氏名は出さない**（件数のみ）。
 *
 * 全員分が引けないときは設定・権限を疑う手掛かりになり、数人だけなら
 * 目標アプリ側の登録漏れか氏名の表記ゆれと分かる。
 */
function warnMissingSalesTargets(
  names: readonly string[],
  /** 実績（PT・契約件数・アポ）に現れた担当者。突合の突き合わせ先 */
  actualNames: ReadonlySet<string>,
  targets: SalesDashboardTargetLookup,
): void {
  const missing = names.filter(
    (name) => (targets.byStaffMonth.get(name)?.size ?? 0) === 0,
  ).length;

  /**
   * 目標側にあるのに実績側に居ない担当者。**ここが多ければ氏名の表記が
   * 食い違っている**（目標アプリと お客様情報・アポ取得情報 で書き方が違う）。
   * 0 に近ければ、単に目標が登録されていないだけと分かる。
   */
  let targetsWithoutRanking = 0;
  targets.byStaffMonth.forEach((_v, name) => {
    if (!actualNames.has(name)) targetsWithoutRanking += 1;
  });

  if (missing === 0 && targetsWithoutRanking === 0) return;
  console.warn(
    "[sales-dashboard] PT目標を引けなかった担当者がいます",
    JSON.stringify({
      missing,
      total: names.length,
      targetsAvailable: targets.available,
      targetsWithoutRanking,
      targetStaff: targets.byStaffMonth.size,
      rankingStaff: actualNames.size,
    }),
  );
}

/** 支社を引けなかった人数を残す。**氏名は出さない**（件数のみ） */
function warnMissingSalesBranches(
  names: readonly string[],
  rosterBranchByStaff: Map<string, string>,
): void {
  const missing = names.filter(
    (name) => !rosterBranchByStaff.get(name)?.trim(),
  ).length;
  if (missing === 0) return;
  console.warn(
    "[sales-dashboard] 所属支社を引けなかった担当者がいます",
    JSON.stringify({ missing, total: names.length }),
  );
}

/**
 * 全月ぶんの集計（サーバ内キャッシュに入れる素材）。
 *
 * ■ 月を含まない
 * 取得も集計も月で絞らない。1回の取得結果から、選択月も年度累計も作れる。
 * 月の選択は buildSalesDashboardPayload が core から取り出すだけで、
 * **@pocket は叩かない。**
 *
 * ■ 呼び出し元の氏名を含まない
 * isSelf の判定はここでは行わない（キャッシュを全社員で共有するため）。
 */
export type SalesDashboardCore = {
  /** 組み立てた時点の JST の年月。月替わりでキャッシュを捨てるために持つ */
  computedYm: string;
  ptByStaffMonth: CustomerPtMonthlyAgg;
  /** 担当者名 → 年月 → 契約件数 */
  contractCountByStaffMonth: Map<string, Map<string, number>>;
  /** 年月 → 担当者名 → PT明細。応答へは選択月ぶんだけ載せる */
  ptBreakdownByStaffMonth: Map<string, Record<string, PtBreakdownRow[]>>;
  apo:
    | { ok: true; byStaffMonth: ApoMonthlyAgg }
    | { ok: false; error: string };
  tenka:
    | { ok: true; byStaffMonth: TenkaMonthlyAgg }
    | { ok: false; error: string };
  targets: SalesDashboardTargetLookup;
  /** 正規化担当者名 → スタッフ名簿の勤務場所（生値） */
  rosterBranchByStaff: Map<string, string>;
  apoEnabled: boolean;
};

export type SalesDashboardSelection = {
  fiscalYear: { key: string; startYear: number; label: string };
  fiscalYearOptions: Array<{ key: string; label: string }>;
  month: FiscalMonthSelection;
};

export async function buildSalesDashboardCore(): Promise<SalesDashboardCore | null> {
  const contractFieldAuth = customerInfoDashboardFieldAuth();
  const contractListAuths = customerInfoDashboardListAuths();
  const contractAppId = salesDashboardContractAppId();
  if (!contractAppId) return null;

  const [apoTenka, contractFields] = await Promise.all([
    buildApoAndTenkaMonthly(),
    fetchAppFields(contractAppId, contractFieldAuth, {
      operation: "sales-dashboard:contract-fields",
      appEnv: "SALES_DASHBOARD_CONTRACT_APP_ID",
    }).catch((e) => {
      console.warn("[sales-dashboard] contract fields skipped", e);
      return null;
    }),
  ]);

  /**
   * 総合PTと契約件数はどちらもお客様情報の同じレコードから作る。列は
   * 1つの Set にまとめ、**1本の取得**に載せる（fields の CSV が伸びるだけで
   * @pocket への問い合わせは増えない）。
   */
  const contractBase = contractFields
    ? resolveContractCountFieldMap(contractFields)
    : null;
  const ptFieldMapCi =
    contractFields && contractBase
      ? resolveCustomerInfoPtFieldMap(contractFields, contractBase)
      : null;

  const contractFieldIdSet = new Set<string>();
  if (ptFieldMapCi) {
    for (const id of [
      ptFieldMapCi.date,
      ptFieldMapCi.customerStatus,
      ptFieldMapCi.apStaff,
      ptFieldMapCi.clStaff,
      ptFieldMapCi.appt,
      ptFieldMapCi.clpt,
      ptFieldMapCi.customerName,
    ]) {
      if (id) contractFieldIdSet.add(id);
    }
  }
  const contractCsv = [...contractFieldIdSet].join(",");

  const [contractRecords, targets] = await Promise.all([
    contractCsv
      ? fetchSalesDashboardRecordPages(
          contractAppId,
          contractCsv,
          contractListAuths,
          {
            operation: "sales-dashboard:contract-records",
            appEnv: "SALES_DASHBOARD_CONTRACT_APP_ID",
          },
        ).catch((e) => {
          console.warn("[sales-dashboard] contract records skipped", e);
          return [] as Array<{ record?: unknown }>;
        })
      : Promise.resolve([] as Array<{ record?: unknown }>),
    // 目標は付加情報。重い2つと並べて取る（この関数は例外を投げない）
    fetchSalesDashboardPtTargets(),
  ]);

  // 総合PTはお客様情報から。APPT は AP担当者へ、CLPT は CL担当者へ
  const customerPt = ptFieldMapCi
    ? aggregateCustomerInfoPt(contractRecords, ptFieldMapCi)
    : {
        byStaffMonth: new Map() as CustomerPtMonthlyAgg,
        breakdownByStaffMonth: new Map<
          string,
          Record<string, PtBreakdownRow[]>
        >(),
      };
  const ptByStaffMonth = customerPt.byStaffMonth;
  const ptBreakdownByStaffMonth = customerPt.breakdownByStaffMonth;

  const contractCountByStaffMonth =
    ptFieldMapCi && contractRecords.length > 0
      ? buildContractCountByMonth(contractRecords, ptFieldMapCi)
      : new Map<string, Map<string, number>>();

  /**
   * 実績側に現れた担当者。目標との突合で「どちら側にしか居ないか」を数える
   * ために、目標由来の名前を混ぜる前の集合を分けて持つ。
   */
  const actualNames = new Set<string>(ptByStaffMonth.keys());
  contractCountByStaffMonth.forEach((_v, name) => actualNames.add(name));
  if (apoTenka.apo.ok) {
    apoTenka.apo.byStaffMonth.forEach((_v, name) => actualNames.add(name));
  }

  // 支社は名簿から1回だけ引く。名前は全月ぶんを集めて渡す
  const allNames = new Set<string>(actualNames);
  targets.byStaffMonth.forEach((_v, name) => allNames.add(name));
  const rosterBranchByStaff = await resolveBranchByStaff([...allNames]);

  /**
   * 設定の取りこぼしを残す。**core を組み立てたときだけ**＝実際に @pocket を
   * 叩いた回にしか出ない。応答の組み立て（buildSalesDashboardPayload）は
   * キャッシュから取り出すだけなので、月や年度を切り替えても増えない。
   */
  warnMissingSalesTargets([...allNames], actualNames, targets);
  warnMissingSalesBranches([...allNames], rosterBranchByStaff);

  return {
    computedYm: currentYmInJst(),
    ptByStaffMonth,
    contractCountByStaffMonth,
    ptBreakdownByStaffMonth,
    apo: apoTenka.apo,
    tenka: apoTenka.tenka,
    targets,
    rosterBranchByStaff,
    apoEnabled: Boolean(salesDashboardApoAppId()),
  };
}

/** 選択期間に含まれる年月キー。「年間」なら年度の12ヶ月 */
function selectionYmKeys(selection: SalesDashboardSelection): string[] {
  if (selection.month.kind === "annual") {
    return fiscalYearMonths(selection.fiscalYear.startYear).map((m) => m.ym);
  }
  return [selection.month.ym];
}

/** 画面の見出し用。単月は「2026年9月」、年間は年度のラベル */
function selectionLabels(selection: SalesDashboardSelection): {
  label: string;
  hint: string;
} {
  const months = fiscalYearMonths(selection.fiscalYear.startYear);
  if (selection.month.kind === "annual") {
    return {
      label: `${selection.fiscalYear.label}（年間）`,
      hint: `${months[0]?.ym ?? ""} ～ ${months[months.length - 1]?.ym ?? ""}`,
    };
  }
  return { label: selection.month.label, hint: selection.month.ym };
}

/** 進捗の内訳へ isSelf の枠を付ける。値は personalize が入れる */
function toProgressPayload(
  progress: SalesDashboardProgress,
): SalesDashboardProgressPayload {
  return {
    company: progress.company,
    branches: progress.branches.map((b) => ({
      label: b.label,
      memberCount: b.memberCount,
      metrics: b.metrics,
      members: b.members.map((m) => ({
        staffName: m.staffName,
        isSelf: false,
        metrics: m.metrics,
      })),
    })),
    targetsAvailable: progress.targetsAvailable,
  };
}

/**
 * 選択期間ぶんを core から取り出して応答を組み立てる。**@pocket は叩かない。**
 * 並び替え・順位付けは月ごとに掛け直す（順位は期間に依存するため）。
 */
export function buildSalesDashboardPayload(
  core: SalesDashboardCore,
  boundStaffName: string,
  selection: SalesDashboardSelection,
): SalesDashboardPayload {
  const bound = normApClStaffName(boundStaffName);
  const ymKeys = selectionYmKeys(selection);
  const single = selection.month.kind === "month" ? selection.month.ym : null;
  const branchConfig = salesProgressBranchConfig();
  const labels = selectionLabels(selection);

  // ── 総合PT ────────────────────────────────────────
  const byStaff = new Map<string, StaffAgg>();
  sumCustomerPtMonths(core.ptByStaffMonth, ymKeys).forEach((pt, name) => {
    byStaff.set(name, { name, pt, contractCount: 0 });
  });
  mergeContractCounts(byStaff, core.contractCountByStaffMonth, ymKeys);

  // 目標は並び替えの第2キーなので、並べる前に引いておく
  const targetPtByStaff = single
    ? pickTargetPtByStaff(core.targets, single)
    : sumTargetPtByStaff(core.targets, ymKeys);
  const sorted = sortStaffAgg([...byStaff.values()], targetPtByStaff);

  const companyPt = sorted.reduce((s, x) => s + x.pt, 0);
  const companyCount = sorted.reduce((s, x) => s + x.contractCount, 0);
  const kpi: SalesDashboardKpi = {
    pt: companyPt,
    contractCount: companyCount,
  };

  const ranking = buildRanking(
    sorted,
    companyPt,
    bound,
    targetPtByStaff,
    core.rosterBranchByStaff,
  );
  // ── アポ件数 ──────────────────────────────────────
  const apoItems = core.apo.ok
    ? single
      ? pickApoMonth(core.apo.byStaffMonth, single)
      : sumApoMonths(core.apo.byStaffMonth, ymKeys)
    : [];
  const apoSorted = sortApoAgg(apoItems);
  const totalApo = apoSorted.reduce((s, x) => s + x.apoCount, 0);

  // ── AP天下賞（画面には出していないが型は保つ） ──
  const tenkaItems = core.tenka.ok
    ? single
      ? pickTenkaMonth(core.tenka.byStaffMonth, single)
      : sumTenkaMonths(core.tenka.byStaffMonth, ymKeys)
    : [];
  const tenkaSorted = sortTenkaAgg(tenkaItems);
  const totalTenka = tenkaSorted.reduce((s, x) => s + x.targetCount, 0);

  // ── 全体の進捗・支社別 ────────────────────────────
  const apoActualByStaff = new Map(
    apoItems.map((it) => [it.name, it.apoCount] as const),
  );
  const ptActualByStaff = new Map(
    [...byStaff.values()].map((it) => [it.name, it.pt] as const),
  );
  const progress = buildSalesDashboardProgress({
    ymKeys,
    targets: core.targets,
    ptActualByStaff,
    apoActualByStaff,
    rosterBranchByStaff: core.rosterBranchByStaff,
    branchConfig,
  });

  const annualYmKeys = fiscalYearMonths(selection.fiscalYear.startYear).map(
    (m) => m.ym,
  );
  const annualProgress =
    selection.month.kind === "annual"
      ? progress
      : buildSalesDashboardProgress({
          ymKeys: annualYmKeys,
          targets: core.targets,
          ptActualByStaff: sumCustomerPtMonths(
            core.ptByStaffMonth,
            annualYmKeys,
          ),
          apoActualByStaff: new Map(
            (core.apo.ok
              ? sumApoMonths(core.apo.byStaffMonth, annualYmKeys)
              : []
            ).map((it) => [it.name, it.apoCount] as const),
          ),
          rosterBranchByStaff: core.rosterBranchByStaff,
          branchConfig,
        });

  return {
    staffName: boundStaffName,
    periodLabel: labels.label,
    periodHint: labels.hint,
    fiscalYear: selection.fiscalYear,
    fiscalYearOptions: selection.fiscalYearOptions,
    monthOptions: buildFiscalMonthOptions(selection.fiscalYear.startYear),
    selectedMonth:
      selection.month.kind === "annual"
        ? FISCAL_ANNUAL_MONTH_KEY
        : selection.month.ym,
    selectedMonthLabel: labels.label,
    progress: toProgressPayload(progress),
    annualProgress: toProgressPayload(annualProgress),
    kpi,
    ranking,
    // 明細は単月のときだけ。年間ぶんを載せると応答が跳ねる
    ptBreakdownByStaff: single
      ? (core.ptBreakdownByStaffMonth.get(single) ?? {})
      : {},
    apoEnabled: core.apoEnabled,
    apoReady: core.apo.ok,
    apoError: core.apo.ok ? null : core.apo.error,
    apoKpi: core.apo.ok ? { totalApoCount: totalApo } : null,
    apoRanking: core.apo.ok ? buildApoRanking(apoSorted, totalApo, bound) : [],
    tenkaReady: core.tenka.ok,
    tenkaError: core.tenka.ok ? null : core.tenka.error,
    tenkaKpi: core.tenka.ok ? { totalTargetCount: totalTenka } : null,
    tenkaRanking: core.tenka.ok
      ? buildTenkaRanking(tenkaSorted, totalTenka, bound)
      : [],
  };
}
