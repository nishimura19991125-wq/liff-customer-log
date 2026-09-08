import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { resolveCustomerInfoFormFieldId } from "@/lib/customer-info-form/resolve-fields";
import { customerInfoNameFieldId } from "@/lib/customer-info-config";
import { readCustomerInfoFieldValue } from "@/lib/customer-info-record";
import { isCustomerStatusCancelledExact } from "@/lib/customer-status-label";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import { formatYmKey } from "@/lib/fiscal-year";
import { isExcludedSalesDashboardRankingName } from "@/lib/sales-dashboard-ranking-exclude";
import { parseSalesDashboardRecordYmFromField } from "@/lib/sales-dashboard-record-date";
import { parseSalesDashboardRecordYmdFromField } from "@/lib/sales-dashboard-record-date";

/**
 * 総合PTをお客様情報アプリから集計する。
 *
 * ■ 帰属
 * 1レコードにつき **APPT は AP担当者へ、CLPT は CL担当者へ**足す。
 * 同一人物が AP と CL を兼ねるときは両方がその人に入るが、転記側
 * （computePtTransfer）が APPT を 0 にしているので合計は PT 全体になり、
 * 二重計上にはならない。別人なら半分ずつ入る。
 *
 * ■ 月と除外
 * 月は**初回契約日**で判定する。顧客ステータスがキャンセルのレコードは
 * 除外する。判定は isCustomerStatusCancelledExact（NFKC＋完全一致）で、
 * 契約件数の集計と同じ関数を使う。
 *
 * ■ 対象月では絞らない
 * 取得は日付で絞っていないので、担当者ごと・年月ごとに積む。選択月も
 * 年度累計も同じ1回の取得から作れる（アポ件数・目標と同じ作り）。
 */

export type CustomerInfoPtFieldMap = {
  /** 初回契約日 */
  date: string;
  /** 顧客ステータス。未解決ならキャンセル除外は掛からない */
  customerStatus: string | null;
  apStaff: string;
  clStaff: string;
  appt: string;
  clpt: string;
  /** PT明細のお客様名。引けなければ空欄で出す */
  customerName: string | null;
};

/** 担当者1人・1ヶ月ぶんの PT */
export type CustomerPtAggItem = { name: string; pt: number };

/** 担当者名 → 年月（YYYY-MM）→ その月の PT */
export type CustomerPtMonthlyAgg = Map<string, Map<string, CustomerPtAggItem>>;

/**
 * PT明細1行。**お客様情報のレコードがそのまま1行**になる。
 *
 * AP と CL が同一人物なら1行にまとめ、APPT＋CLPT の合計を出す。
 * 別人なら、その人に帰属する側の値（AP側は APPT・CL側は CLPT）を出す。
 */
export type PtBreakdownRow = {
  customerName: string;
  apPerson: string;
  clPerson: string;
  /** この行が誰の明細か（正規化済み担当者名） */
  salesperson: string;
  pt: number;
  /** 内部キー YYYY-MM-DD（表示は UI で formatDisplayYmd） */
  dateYmd: string;
};

/** 読めなかった日付の生値を残す件数 */
const DATE_SAMPLE_LIMIT = 2;
const DATE_SAMPLE_MAX_LENGTH = 40;
/** 月別の内訳を残す範囲。古い月まで出すとログが読めなくなる */
const COUNTED_BY_YM_LIMIT = 24;

/** 数字だけを見る。「-」（未入力）は 0。マイナス記号は落ちる */
function parseNumber(raw: string): number {
  const digits = raw.replace(/[^\d]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

/**
 * PT の集計に要る列。担当者は CUSTOMER_INFO_FIELD_AP_STAFF / _CL_STAFF、
 * PT は CUSTOMER_INFO_FIELD_APPT / _CLPT（いずれも未設定なら見出しの完全一致）。
 * 日付と顧客ステータスは呼び出し側が渡す（契約件数と同じ列を使うため）。
 */
export function resolveCustomerInfoPtFieldMap(
  fields: AtPocketFieldRow[],
  base: { date: string; customerStatus: string | null },
): CustomerInfoPtFieldMap | null {
  const apStaff = resolveCustomerInfoFormFieldId("apStaff", "AP担当者", fields);
  const clStaff = resolveCustomerInfoFormFieldId("clStaff", "CL担当者", fields);
  const appt = resolveCustomerInfoFormFieldId("appt", "APPT", fields);
  const clpt = resolveCustomerInfoFormFieldId("clpt", "CLPT", fields);
  if (!apStaff || !clStaff || !appt || !clpt) return null;

  const nameEnv = customerInfoNameFieldId();
  const customerName = nameEnv
    ? resolveConfiguredFieldToSchemaUniqueId(nameEnv, fields)
    : resolveCustomerInfoFormFieldId("customerName", "お客様名", fields);

  return {
    date: base.date,
    customerStatus: base.customerStatus,
    apStaff,
    clStaff,
    appt,
    clpt,
    customerName,
  };
}

/**
 * どの条件で何件落ちたかを残す。**氏名・顧客名は出さない**（件数のみ）。
 * アポ件数の集計内訳と同じ流儀。
 */
type CustomerPtCounts = {
  total: number;
  cancelled: number;
  dateUnparsed: number;
  /** AP・CL のどちらも名前が無い（帰属先が決まらない） */
  noName: number;
  /** 除外担当者（トラーチ倶楽部・卸案件など）に当たった帰属の数 */
  excludedName: number;
  /** APPT を足した回数 */
  apAttributed: number;
  /** CLPT を足した回数 */
  clAttributed: number;
  /** 集計に入ったレコード数 */
  counted: number;
};

function logCustomerPtCounts(
  counts: CustomerPtCounts,
  countedByYm: Map<string, number>,
  dateSamples: string[],
): void {
  const recent = [...countedByYm.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, COUNTED_BY_YM_LIMIT);

  console.info(
    "[sales-dashboard] 総合PTの集計内訳",
    JSON.stringify({
      ...counts,
      months: countedByYm.size,
      countedByYm: Object.fromEntries(recent),
      ...(dateSamples.length ? { dateSamples } : {}),
    }),
  );
}

export type CustomerInfoPtResult = {
  byStaffMonth: CustomerPtMonthlyAgg;
  /** 年月 → 担当者名 → PT明細。応答へ載せるのは選択月ぶんだけ */
  breakdownByStaffMonth: Map<string, Record<string, PtBreakdownRow[]>>;
};

export function aggregateCustomerInfoPt(
  records: Array<{ record?: unknown }>,
  fieldMap: CustomerInfoPtFieldMap,
): CustomerInfoPtResult {
  const byStaffMonth: CustomerPtMonthlyAgg = new Map();
  const breakdownByMonthStaff = new Map<
    string,
    Map<string, PtBreakdownRow[]>
  >();

  const counts: CustomerPtCounts = {
    total: records.length,
    cancelled: 0,
    dateUnparsed: 0,
    noName: 0,
    excludedName: 0,
    apAttributed: 0,
    clAttributed: 0,
    counted: 0,
  };
  const dateSamples: string[] = [];
  const countedByYm = new Map<string, number>();

  const addPt = (name: string, ymKey: string, pt: number) => {
    let byMonth = byStaffMonth.get(name);
    if (!byMonth) {
      byMonth = new Map();
      byStaffMonth.set(name, byMonth);
    }
    const cur = byMonth.get(ymKey) ?? { name, pt: 0 };
    cur.pt += pt;
    byMonth.set(ymKey, cur);
  };

  const addBreakdown = (ymKey: string, name: string, row: PtBreakdownRow) => {
    // PT が無い行は明細に出さない（従来の明細と同じ）
    if (row.pt <= 0) return;
    let byStaff = breakdownByMonthStaff.get(ymKey);
    if (!byStaff) {
      byStaff = new Map();
      breakdownByMonthStaff.set(ymKey, byStaff);
    }
    const list = byStaff.get(name) ?? [];
    list.push(row);
    byStaff.set(name, list);
  };

  for (const row of records) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const recObj = rec as Record<string, unknown>;

    if (fieldMap.customerStatus) {
      const status = readCustomerInfoFieldValue(recObj, fieldMap.customerStatus);
      if (isCustomerStatusCancelledExact(status)) {
        counts.cancelled += 1;
        continue;
      }
    }

    const ym = parseSalesDashboardRecordYmFromField(recObj, fieldMap.date);
    if (!ym) {
      counts.dateUnparsed += 1;
      if (dateSamples.length < DATE_SAMPLE_LIMIT) {
        const raw = readCustomerInfoFieldValue(recObj, fieldMap.date);
        if (raw) dateSamples.push(raw.slice(0, DATE_SAMPLE_MAX_LENGTH));
      }
      continue;
    }
    const ymKey = formatYmKey(ym.year, ym.month1);

    const apRaw = readCustomerInfoFieldValue(recObj, fieldMap.apStaff).trim();
    const clRaw = readCustomerInfoFieldValue(recObj, fieldMap.clStaff).trim();
    const apName = normApClStaffName(apRaw);
    const clName = normApClStaffName(clRaw);
    if (!apName && !clName) {
      counts.noName += 1;
      continue;
    }

    const apPt = parseNumber(readCustomerInfoFieldValue(recObj, fieldMap.appt));
    const clPt = parseNumber(readCustomerInfoFieldValue(recObj, fieldMap.clpt));

    const apUsable = Boolean(apName) && !isExcludedSalesDashboardRankingName(apName);
    const clUsable = Boolean(clName) && !isExcludedSalesDashboardRankingName(clName);
    if (apName && !apUsable) counts.excludedName += 1;
    if (clName && !clUsable) counts.excludedName += 1;
    if (!apUsable && !clUsable) continue;

    const customerName = fieldMap.customerName
      ? readCustomerInfoFieldValue(recObj, fieldMap.customerName)
      : "";
    const dateYmd = parseSalesDashboardRecordYmdFromField(recObj, fieldMap.date);
    const base = { customerName, apPerson: apRaw, clPerson: clRaw, dateYmd };

    if (apUsable && clUsable && apName === clName) {
      // AP と CL が同一人物。明細は1行にまとめ、合計を出す
      addPt(apName, ymKey, apPt + clPt);
      counts.apAttributed += 1;
      counts.clAttributed += 1;
      addBreakdown(ymKey, apName, {
        ...base,
        salesperson: apName,
        pt: apPt + clPt,
      });
    } else {
      if (apUsable) {
        addPt(apName, ymKey, apPt);
        counts.apAttributed += 1;
        addBreakdown(ymKey, apName, { ...base, salesperson: apName, pt: apPt });
      }
      if (clUsable) {
        addPt(clName, ymKey, clPt);
        counts.clAttributed += 1;
        addBreakdown(ymKey, clName, { ...base, salesperson: clName, pt: clPt });
      }
    }

    counts.counted += 1;
    countedByYm.set(ymKey, (countedByYm.get(ymKey) ?? 0) + 1);
  }

  logCustomerPtCounts(counts, countedByYm, dateSamples);

  const breakdownByStaffMonth = new Map<
    string,
    Record<string, PtBreakdownRow[]>
  >();
  breakdownByMonthStaff.forEach((byStaff, ymKey) => {
    const perMonth: Record<string, PtBreakdownRow[]> = {};
    byStaff.forEach((rows, name) => {
      rows.sort((a, b) => {
        const byDate = (b.dateYmd || "").localeCompare(a.dateYmd || "");
        if (byDate !== 0) return byDate;
        return b.pt - a.pt;
      });
      perMonth[name] = rows;
    });
    breakdownByStaffMonth.set(ymKey, perMonth);
  });

  return { byStaffMonth, breakdownByStaffMonth };
}

/** 指定の月ぶんを取り出して足す（1件なら単月・12件なら年度累計） */
export function sumCustomerPtMonths(
  byStaffMonth: CustomerPtMonthlyAgg,
  ymKeys: readonly string[],
): Map<string, number> {
  const out = new Map<string, number>();
  byStaffMonth.forEach((byMonth, name) => {
    let pt = 0;
    let found = false;
    for (const ymKey of ymKeys) {
      const hit = byMonth.get(ymKey);
      if (!hit) continue;
      found = true;
      pt += hit.pt;
    }
    if (found) out.set(name, pt);
  });
  return out;
}
