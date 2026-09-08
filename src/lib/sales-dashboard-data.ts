import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import { apiKeyForAppFields, fetchAppFields } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import { resolveCustomerInfoRegistrationNumberFieldIds } from "@/lib/construction-customer-info-sync-fields";
import {
  customerInfoDashboardFieldAuth,
  customerInfoDashboardListAuths,
  customerInfoNameFieldId,
} from "@/lib/customer-info-config";
import { resolveCustomerInfoFormFieldId } from "@/lib/customer-info-form/resolve-fields";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { readCustomerInfoFieldValue } from "@/lib/customer-info-record";
import type {
  ApoDashboardKpi,
  ApoDashboardRankingRow,
} from "@/lib/sales-dashboard-apo-aggregate";
import { CUSTOMER_STATUS_CANCELLED } from "@/lib/customer-status-label";
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
  resolvePtDashboardFieldMap,
  salesDashboardApoAppId,
  salesDashboardContractAppId,
  salesDashboardPtAppId,
  type ContractCountFieldMap,
  type PtDashboardFieldMap,
} from "@/lib/sales-dashboard-fields";
import { achievementRate } from "@/lib/sales-dashboard-achievement";
import { fetchSalesDashboardRecordPages, salesDashboardPtListAuths } from "@/lib/sales-dashboard-list-fetch";
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
  formatYmKey,
  type FiscalMonthSelection,
} from "@/lib/fiscal-year";
import {
  lookupStaffWorkplaceByStaffName,
  resolveStaffWorkplaceLookupConfig,
} from "@/lib/staff-workplace-lookup";
import type { SalesDashboardPeriodKey } from "@/lib/sales-dashboard-period";
import { isExcludedSalesDashboardRankingName } from "@/lib/sales-dashboard-ranking-exclude";
import {
  parseSalesDashboardRecordYmFromField,
  parseSalesDashboardRecordYmdFromField,
} from "@/lib/sales-dashboard-record-date";

export type { ApoDashboardKpi, ApoDashboardRankingRow };

export type SalesDashboardKpi = {
  pt: number;
  salesAmount: number;
  contractCount: number;
  avgAmount: number;
};

export type SalesDashboardRankingRow = {
  rank: number;
  staffName: string;
  pt: number;
  salesAmount: number;
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

/** PT集計表レコード単位の明細（お客様情報の登録番号突合付き） */
export type PtBreakdownRow = {
  customerName: string;
  apPerson: string;
  clPerson: string;
  salesperson: string;
  pt: number;
  sales: number;
  /** 内部キー YYYY-MM-DD（表示は UI で formatDisplayYmd） */
  dateYmd: string;
};

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
  period: SalesDashboardPeriodKey;
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
  salesAmount: number;
  contractCount: number;
};

type CustomerLookupByRegistration = {
  customerName: string;
  apPerson: string;
  clPerson: string;
};

function parseNumber(raw: string): number {
  const digits = raw.replace(/[^\d]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

/** 登録番号の突合用正規化（先頭ゼロを落とさないよう数値化しない） */
function normalizeRegistrationNumber(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/g, "").trim();
}

function monthKeyFromYm(year: number, month1: number): string {
  return `${year}-${String(month1).padStart(2, "0")}`;
}

function buildCustomerLookupByRegistrationNumber(
  records: Array<{ record?: unknown }>,
  opts: {
    nameFieldId: string | null;
    apStaffFieldId: string | null;
    clStaffFieldId: string | null;
    apptRegistrationNumberFieldId: string | null;
    clptRegistrationNumberFieldId: string | null;
  },
): Map<string, CustomerLookupByRegistration> {
  const map = new Map<string, CustomerLookupByRegistration>();
  const {
    nameFieldId,
    apStaffFieldId,
    clStaffFieldId,
    apptRegistrationNumberFieldId,
    clptRegistrationNumberFieldId,
  } = opts;
  if (!apptRegistrationNumberFieldId && !clptRegistrationNumberFieldId) {
    return map;
  }

  for (const row of records) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const recObj = rec as Record<string, unknown>;

    const info: CustomerLookupByRegistration = {
      customerName: nameFieldId
        ? readCustomerInfoFieldValue(recObj, nameFieldId)
        : "",
      apPerson: apStaffFieldId
        ? normApClStaffName(readCustomerInfoFieldValue(recObj, apStaffFieldId))
        : "",
      clPerson: clStaffFieldId
        ? normApClStaffName(readCustomerInfoFieldValue(recObj, clStaffFieldId))
        : "",
    };

    for (const fieldId of [
      apptRegistrationNumberFieldId,
      clptRegistrationNumberFieldId,
    ]) {
      if (!fieldId) continue;
      const key = normalizeRegistrationNumber(
        readCustomerInfoFieldValue(recObj, fieldId),
      );
      if (!key || map.has(key)) continue;
      map.set(key, info);
    }
  }

  return map;
}

/** 担当者名 → 年月（YYYY-MM）→ その月の PT 実績 */
type PtMonthlyAgg = Map<string, Map<string, StaffAgg>>;

/**
 * PT集計表: ranking_pt_dashboard.js aggregate() 相当。
 *
 * **対象月では絞らない。** 取得は元から日付で絞っていないので、全月を
 * 担当者ごと・年月ごとに積んでも @pocket への問い合わせは増えない。
 * 月を選ぶのは pickPtMonth / sumPtMonths を呼ぶ側の仕事。
 */
function aggregatePtRecords(
  records: Array<{ record?: unknown }>,
  fieldMap: PtDashboardFieldMap,
): PtMonthlyAgg {
  const m: PtMonthlyAgg = new Map();

  for (const row of records) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const recObj = rec as Record<string, unknown>;

    const name = normApClStaffName(
      readCustomerInfoFieldValue(recObj, fieldMap.salesperson),
    );
    if (!name || isExcludedSalesDashboardRankingName(name)) continue;

    const ym = parseSalesDashboardRecordYmFromField(recObj, fieldMap.date);
    if (!ym) continue;

    const pt = fieldMap.pt
      ? parseNumber(readCustomerInfoFieldValue(recObj, fieldMap.pt))
      : 0;
    const salesRaw = fieldMap.sales
      ? readCustomerInfoFieldValue(recObj, fieldMap.sales)
      : "";
    const sales = fieldMap.sales && pt !== 0 ? parseNumber(salesRaw) : 0;

    const ymKey = formatYmKey(ym.year, ym.month1);
    let byMonth = m.get(name);
    if (!byMonth) {
      byMonth = new Map();
      m.set(name, byMonth);
    }
    const cur = byMonth.get(ymKey) ?? {
      name,
      pt: 0,
      salesAmount: 0,
      contractCount: 0,
    };
    cur.pt += pt;
    if (pt !== 0) cur.salesAmount += sales;
    byMonth.set(ymKey, cur);
  }

  return m;
}

/**
 * 指定の月ぶんを取り出して足す（1件なら単月・12件なら年度累計）。
 * 契約件数はここでは 0 のまま。あとで mergeContractCounts が入れる。
 */
function sumPtMonths(
  byStaffMonth: PtMonthlyAgg,
  ymKeys: readonly string[],
): Map<string, StaffAgg> {
  const out = new Map<string, StaffAgg>();
  byStaffMonth.forEach((byMonth, name) => {
    let pt = 0;
    let salesAmount = 0;
    let found = false;
    for (const ymKey of ymKeys) {
      const hit = byMonth.get(ymKey);
      if (!hit) continue;
      found = true;
      pt += hit.pt;
      salesAmount += hit.salesAmount;
    }
    if (!found) return;
    out.set(name, { name, pt, salesAmount, contractCount: 0 });
  });
  return out;
}

/**
 * PT>0 の PT 明細を **年月ごと・担当者ごと** に組み立てる。
 * 明細 PT 合計は aggregatePtRecords の pt と一致する（同じフィルタ・同じ parseNumber）。
 * ※ aggregate は pt=0 も加算対象だが加算値は 0。明細は PT>0 のみ表示する。
 *
 * 応答へ載せるのは**選択月の1ヶ月ぶんだけ**。全月を返すとレスポンスが跳ねる。
 * ここで全月ぶんを持つのはサーバ内キャッシュの中だけで、月を切り替えても
 * @pocket を叩かずに済ませるため。
 */
function buildPtBreakdownByStaffMonth(
  records: Array<{ record?: unknown }>,
  fieldMap: PtDashboardFieldMap,
  customerByReg: Map<string, CustomerLookupByRegistration>,
): Map<string, Record<string, PtBreakdownRow[]>> {
  const byMonthStaff = new Map<string, Map<string, PtBreakdownRow[]>>();

  for (const row of records) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const recObj = rec as Record<string, unknown>;

    const salesperson = normApClStaffName(
      readCustomerInfoFieldValue(recObj, fieldMap.salesperson),
    );
    if (!salesperson || isExcludedSalesDashboardRankingName(salesperson)) {
      continue;
    }

    const ym = parseSalesDashboardRecordYmFromField(recObj, fieldMap.date);
    if (!ym) continue;

    const pt = fieldMap.pt
      ? parseNumber(readCustomerInfoFieldValue(recObj, fieldMap.pt))
      : 0;
    if (pt <= 0) continue;

    const salesRaw = fieldMap.sales
      ? readCustomerInfoFieldValue(recObj, fieldMap.sales)
      : "";
    const sales = fieldMap.sales ? parseNumber(salesRaw) : 0;

    const regKey = fieldMap.registrationNumber
      ? normalizeRegistrationNumber(
          readCustomerInfoFieldValue(recObj, fieldMap.registrationNumber),
        )
      : "";
    const matched = regKey ? customerByReg.get(regKey) : undefined;

    const item: PtBreakdownRow = {
      customerName: matched?.customerName ?? "",
      apPerson: matched?.apPerson ?? "",
      clPerson: matched?.clPerson ?? "",
      salesperson,
      pt,
      sales,
      dateYmd: parseSalesDashboardRecordYmdFromField(recObj, fieldMap.date),
    };

    const ymKey = formatYmKey(ym.year, ym.month1);
    let byStaff = byMonthStaff.get(ymKey);
    if (!byStaff) {
      byStaff = new Map();
      byMonthStaff.set(ymKey, byStaff);
    }
    const list = byStaff.get(salesperson) ?? [];
    list.push(item);
    byStaff.set(salesperson, list);
  }

  const out = new Map<string, Record<string, PtBreakdownRow[]>>();
  byMonthStaff.forEach((byStaff, ymKey) => {
    const perMonth: Record<string, PtBreakdownRow[]> = {};
    byStaff.forEach((rows, name) => {
      rows.sort((a, b) => {
        const byDate = (b.dateYmd || "").localeCompare(a.dateYmd || "");
        if (byDate !== 0) return byDate;
        return b.pt - a.pt;
      });
      perMonth[name] = rows;
    });
    out.set(ymKey, perMonth);
  });
  return out;
}

/** 契約情報: buildContractCountMap + 対象月 */
function buildContractCountByMonth(
  records: Array<{ record?: unknown }>,
  fieldMap: ContractCountFieldMap,
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
      // 値の直書きをやめ、顧客ステータスの定義と1か所で揃える
      if (status === CUSTOMER_STATUS_CANCELLED) continue;
    }

    const name = normApClStaffName(
      readCustomerInfoFieldValue(recObj, fieldMap.clPerson),
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
    const cur = byStaff.get(name) ?? {
      name,
      pt: 0,
      salesAmount: 0,
      contractCount: 0,
    };
    cur.contractCount = count;
    byStaff.set(name, cur);
  });
}

function sortStaffAgg(items: StaffAgg[]): StaffAgg[] {
  const visible = items.filter(
    (it) => !isExcludedSalesDashboardRankingName(it.name),
  );
  return [...visible].sort(
    (a, b) =>
      b.pt - a.pt ||
      b.salesAmount - a.salesAmount ||
      b.contractCount - a.contractCount ||
      a.name.localeCompare(b.name, "ja"),
  );
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
      salesAmount: item.salesAmount,
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
  ranking: SalesDashboardRankingRow[],
  targetsAvailable: boolean,
): void {
  const missing = ranking.filter((r) => r.targetPt <= 0).length;
  if (missing === 0) return;
  console.warn(
    "[sales-dashboard] PT目標を引けなかった担当者がいます",
    JSON.stringify({
      missing,
      total: ranking.length,
      targetsAvailable,
    }),
  );
}

/** 支社を引けなかった人数を残す。**氏名は出さない**（件数のみ） */
function warnMissingSalesBranches(ranking: SalesDashboardRankingRow[]): void {
  const missing = ranking.filter((r) => !r.branch).length;
  if (missing === 0) return;
  console.warn(
    "[sales-dashboard] 所属支社を引けなかった担当者がいます",
    JSON.stringify({ missing, total: ranking.length }),
  );
}

function resolveCustomerLookupFieldIds(contractFields: AtPocketFieldRow[]): {
  nameFieldId: string | null;
  apStaffFieldId: string | null;
  clStaffFieldId: string | null;
  apptRegistrationNumberFieldId: string | null;
  clptRegistrationNumberFieldId: string | null;
} {
  const nameEnv = customerInfoNameFieldId();
  const nameFieldId = nameEnv
    ? resolveConfiguredFieldToSchemaUniqueId(nameEnv, contractFields)
    : resolveCustomerInfoFormFieldId(
        "customerName",
        "お客様名",
        contractFields,
      );

  const apStaffFieldId = resolveCustomerInfoFormFieldId(
    "apStaff",
    "AP担当者",
    contractFields,
  );
  const clStaffFieldId = resolveCustomerInfoFormFieldId(
    "clStaff",
    "CL担当者",
    contractFields,
  );
  const regIds = resolveCustomerInfoRegistrationNumberFieldIds(contractFields);

  return {
    nameFieldId,
    apStaffFieldId,
    clStaffFieldId,
    apptRegistrationNumberFieldId: regIds.apptRegistrationNumber,
    clptRegistrationNumberFieldId: regIds.clptRegistrationNumber,
  };
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
  ptByStaffMonth: PtMonthlyAgg;
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
  /**
   * 旧クエリ（?period=current|previous）で来たときの目印。
   * 画面をまだ差し替えていないので、応答の period は残している。
   */
  legacyPeriod: SalesDashboardPeriodKey;
};

export async function buildSalesDashboardCore(): Promise<SalesDashboardCore | null> {
  const ptAppId = salesDashboardPtAppId();
  if (!ptAppId) return null;

  const ptFieldAuth = { apiKey: apiKeyForAppFields("SALES_DASHBOARD_PT") };
  const ptListAuths = salesDashboardPtListAuths();
  const contractFieldAuth = customerInfoDashboardFieldAuth();
  const contractListAuths = customerInfoDashboardListAuths();
  const contractAppId = salesDashboardContractAppId();

  const [apoTenka, ptFields, contractFields] = await Promise.all([
    buildApoAndTenkaMonthly(),
    fetchAppFields(ptAppId, ptFieldAuth, {
      operation: "sales-dashboard:pt-fields",
      appEnv: "SALES_DASHBOARD_PT_APP_ID",
    }),
    contractAppId
      ? fetchAppFields(contractAppId, contractFieldAuth, {
          operation: "sales-dashboard:contract-fields",
          appEnv: "SALES_DASHBOARD_CONTRACT_APP_ID",
        }).catch((e) => {
          console.warn("[sales-dashboard] contract fields skipped", e);
          return null;
        })
      : Promise.resolve(null),
  ]);

  const ptFieldMap = resolvePtDashboardFieldMap(ptFields);
  if (!ptFieldMap) return null;

  const ptWanted = [
    ptFieldMap.salesperson,
    ptFieldMap.date,
    ptFieldMap.pt,
    ptFieldMap.sales,
    ptFieldMap.registrationNumber,
  ].filter(Boolean) as string[];

  const contractFieldMap = contractFields
    ? resolveContractCountFieldMap(contractFields)
    : null;
  const customerLookupFields = contractFields
    ? resolveCustomerLookupFieldIds(contractFields)
    : null;

  const contractFieldIdSet = new Set<string>();
  if (contractFieldMap) {
    for (const id of [
      contractFieldMap.date,
      contractFieldMap.clPerson,
      contractFieldMap.customerStatus,
    ]) {
      if (id) contractFieldIdSet.add(id);
    }
  }
  if (customerLookupFields) {
    for (const id of [
      customerLookupFields.nameFieldId,
      customerLookupFields.apStaffFieldId,
      customerLookupFields.clStaffFieldId,
      customerLookupFields.apptRegistrationNumberFieldId,
      customerLookupFields.clptRegistrationNumberFieldId,
    ]) {
      if (id) contractFieldIdSet.add(id);
    }
  }
  const contractCsv = [...contractFieldIdSet].join(",");

  const [ptRecords, contractRecords, targets] = await Promise.all([
    fetchSalesDashboardRecordPages(ptAppId, ptWanted.join(","), ptListAuths, {
      operation: "sales-dashboard:pt-records",
      appEnv: "SALES_DASHBOARD_PT_APP_ID",
    }),
    contractAppId && contractCsv
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

  const ptByStaffMonth = aggregatePtRecords(ptRecords, ptFieldMap);

  const contractCountByStaffMonth =
    contractFieldMap && contractRecords.length > 0
      ? buildContractCountByMonth(contractRecords, contractFieldMap)
      : new Map<string, Map<string, number>>();

  const customerByReg = customerLookupFields
    ? buildCustomerLookupByRegistrationNumber(
        contractRecords,
        customerLookupFields,
      )
    : new Map<string, CustomerLookupByRegistration>();

  const ptBreakdownByStaffMonth = buildPtBreakdownByStaffMonth(
    ptRecords,
    ptFieldMap,
    customerByReg,
  );

  // 支社は名簿から1回だけ引く。名前は全月ぶんを集めて渡す
  const allNames = new Set<string>(ptByStaffMonth.keys());
  contractCountByStaffMonth.forEach((_v, name) => allNames.add(name));
  targets.byStaffMonth.forEach((_v, name) => allNames.add(name));
  if (apoTenka.apo.ok) {
    apoTenka.apo.byStaffMonth.forEach((_v, name) => allNames.add(name));
  }
  const rosterBranchByStaff = await resolveBranchByStaff([...allNames]);

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
  const byStaff = sumPtMonths(core.ptByStaffMonth, ymKeys);
  mergeContractCounts(byStaff, core.contractCountByStaffMonth, ymKeys);
  const sorted = sortStaffAgg([...byStaff.values()]);

  const companyPt = sorted.reduce((s, x) => s + x.pt, 0);
  const companySales = sorted.reduce((s, x) => s + x.salesAmount, 0);
  const companyCount = sorted.reduce((s, x) => s + x.contractCount, 0);
  const kpi: SalesDashboardKpi = {
    pt: companyPt,
    salesAmount: companySales,
    contractCount: companyCount,
    avgAmount: companyCount > 0 ? Math.round(companySales / companyCount) : 0,
  };

  const targetPtByStaff = single
    ? pickTargetPtByStaff(core.targets, single)
    : sumTargetPtByStaff(core.targets, ymKeys);

  const ranking = buildRanking(
    sorted,
    companyPt,
    bound,
    targetPtByStaff,
    core.rosterBranchByStaff,
  );
  warnMissingSalesTargets(ranking, core.targets.available);
  warnMissingSalesBranches(ranking);

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
          ptActualByStaff: new Map(
            [...sumPtMonths(core.ptByStaffMonth, annualYmKeys).values()].map(
              (it) => [it.name, it.pt] as const,
            ),
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
    period: selection.legacyPeriod,
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
