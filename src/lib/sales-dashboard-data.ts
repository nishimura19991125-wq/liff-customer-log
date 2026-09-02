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
import { buildApoAndTenkaSections } from "@/lib/sales-dashboard-apo-tenka-bundle";
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
import { fetchSalesDashboardPtTargets } from "@/lib/sales-dashboard-target-lookup";
import {
  isYmInPeriod,
  resolveSalesDashboardPeriod,
  type SalesDashboardPeriodKey,
} from "@/lib/sales-dashboard-period";
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

export type SalesDashboardPayload = {
  staffName: string;
  period: SalesDashboardPeriodKey;
  periodLabel: string;
  periodHint: string;
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

/** PT集計表: ranking_pt_dashboard.js aggregate() 相当 */
function aggregatePtRecords(
  records: Array<{ record?: unknown }>,
  fieldMap: PtDashboardFieldMap,
  periodKey: SalesDashboardPeriodKey,
): Map<string, StaffAgg> {
  const period = resolveSalesDashboardPeriod(periodKey);
  const m = new Map<string, StaffAgg>();

  for (const row of records) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const recObj = rec as Record<string, unknown>;

    const name = normApClStaffName(
      readCustomerInfoFieldValue(recObj, fieldMap.salesperson),
    );
    if (!name || isExcludedSalesDashboardRankingName(name)) continue;

    const ym = parseSalesDashboardRecordYmFromField(recObj, fieldMap.date);
    if (!ym || !isYmInPeriod(ym.year, ym.month1, period)) continue;

    const pt = fieldMap.pt
      ? parseNumber(readCustomerInfoFieldValue(recObj, fieldMap.pt))
      : 0;
    const salesRaw = fieldMap.sales
      ? readCustomerInfoFieldValue(recObj, fieldMap.sales)
      : "";
    const sales = fieldMap.sales && pt !== 0 ? parseNumber(salesRaw) : 0;

    const cur = m.get(name) ?? {
      name,
      pt: 0,
      salesAmount: 0,
      contractCount: 0,
    };
    cur.pt += pt;
    if (pt !== 0) cur.salesAmount += sales;
    m.set(name, cur);
  }

  return m;
}

/**
 * 期間内・PT>0 の PT 明細を担当者ごとに組み立てる。
 * 明細 PT 合計は aggregatePtRecords の pt と一致する（同じフィルタ・同じ parseNumber）。
 * ※ aggregate は pt=0 も加算対象だが加算値は 0。明細は PT>0 のみ表示する。
 */
function buildPtBreakdownByStaff(
  records: Array<{ record?: unknown }>,
  fieldMap: PtDashboardFieldMap,
  periodKey: SalesDashboardPeriodKey,
  customerByReg: Map<string, CustomerLookupByRegistration>,
): Record<string, PtBreakdownRow[]> {
  const period = resolveSalesDashboardPeriod(periodKey);
  const byStaff = new Map<string, PtBreakdownRow[]>();

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
    if (!ym || !isYmInPeriod(ym.year, ym.month1, period)) continue;

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

    const list = byStaff.get(salesperson) ?? [];
    list.push(item);
    byStaff.set(salesperson, list);
  }

  const out: Record<string, PtBreakdownRow[]> = {};
  byStaff.forEach((rows, name) => {
    rows.sort((a, b) => {
      const byDate = (b.dateYmd || "").localeCompare(a.dateYmd || "");
      if (byDate !== 0) return byDate;
      return b.pt - a.pt;
    });
    out[name] = rows;
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
  periodKey: SalesDashboardPeriodKey,
): void {
  const period = resolveSalesDashboardPeriod(periodKey);
  const monthKey = `${period.year}-${String(period.month1).padStart(2, "0")}`;

  contractMap.forEach((perMonth, name) => {
    const count = perMonth.get(monthKey) ?? 0;
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

function buildRanking(
  sorted: StaffAgg[],
  companyPt: number,
  bound: string,
  /** 正規化担当者名 → PT 目標。引けない担当者は 0 になる */
  targetPtByStaff: Map<string, number>,
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

export async function buildSalesDashboardPayload(
  boundStaffName: string,
  periodKey: SalesDashboardPeriodKey,
): Promise<SalesDashboardPayload | null> {
  const ptAppId = salesDashboardPtAppId();
  if (!ptAppId) return null;

  const ptFieldAuth = { apiKey: apiKeyForAppFields("SALES_DASHBOARD_PT") };
  const ptListAuths = salesDashboardPtListAuths();
  const contractFieldAuth = customerInfoDashboardFieldAuth();
  const contractListAuths = customerInfoDashboardListAuths();
  const period = resolveSalesDashboardPeriod(periodKey);
  const bound = normApClStaffName(boundStaffName);
  const contractAppId = salesDashboardContractAppId();

  const [apoTenka, ptFields, contractFields] = await Promise.all([
    buildApoAndTenkaSections(boundStaffName, periodKey),
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

  const apoSection = apoTenka.apo;
  const tenkaSection = apoTenka.tenka;

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
    fetchSalesDashboardRecordPages(
      ptAppId,
      ptWanted.join(","),
      ptListAuths,
      {
        operation: "sales-dashboard:pt-records",
        appEnv: "SALES_DASHBOARD_PT_APP_ID",
      },
    ),
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
    fetchSalesDashboardPtTargets(period),
  ]);

  const byStaff = aggregatePtRecords(ptRecords, ptFieldMap, periodKey);

  if (contractFieldMap && contractRecords.length > 0) {
    const contractMap = buildContractCountByMonth(
      contractRecords,
      contractFieldMap,
    );
    mergeContractCounts(byStaff, contractMap, periodKey);
  }

  const customerByReg = customerLookupFields
    ? buildCustomerLookupByRegistrationNumber(
        contractRecords,
        customerLookupFields,
      )
    : new Map<string, CustomerLookupByRegistration>();

  const ptBreakdownByStaff = buildPtBreakdownByStaff(
    ptRecords,
    ptFieldMap,
    periodKey,
    customerByReg,
  );

  const sorted = sortStaffAgg([...byStaff.values()]);

  const companyPt = sorted.reduce((s, x) => s + x.pt, 0);
  const companySales = sorted.reduce((s, x) => s + x.salesAmount, 0);
  const companyCount = sorted.reduce((s, x) => s + x.contractCount, 0);

  const kpi: SalesDashboardKpi = {
    pt: companyPt,
    salesAmount: companySales,
    contractCount: companyCount,
    avgAmount:
      companyCount > 0 ? Math.round(companySales / companyCount) : 0,
  };

  const ranking = buildRanking(sorted, companyPt, bound, targets.ptByStaff);
  warnMissingSalesTargets(ranking, targets.available);

  return {
    staffName: boundStaffName,
    period: periodKey,
    periodLabel: period.label,
    periodHint: period.hint,
    kpi,
    ranking,
    ptBreakdownByStaff,
    apoEnabled: Boolean(salesDashboardApoAppId()),
    apoReady: apoSection.ok,
    apoError: apoSection.ok ? null : apoSection.error,
    apoKpi: apoSection.ok ? apoSection.kpi : null,
    apoRanking: apoSection.ok ? apoSection.ranking : [],
    tenkaReady: tenkaSection.ok,
    tenkaError: tenkaSection.ok ? null : tenkaSection.error,
    tenkaKpi: tenkaSection.ok ? tenkaSection.kpi : null,
    tenkaRanking: tenkaSection.ok ? tenkaSection.ranking : [],
  };
}
