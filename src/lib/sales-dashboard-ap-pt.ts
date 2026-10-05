import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import { AP_RANKING_INTRODUCTION_ROUTES } from "@/lib/customer-info-form/options";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { resolveCustomerInfoFormFieldId } from "@/lib/customer-info-form/resolve-fields";
import { readCustomerInfoFieldValue } from "@/lib/customer-info-record";
import { isCustomerStatusCancelledExact } from "@/lib/customer-status-label";
import { formatYmKey } from "@/lib/fiscal-year";
import type {
  CustomerInfoPtFieldMap,
  CustomerPtMonthlyAgg,
} from "@/lib/sales-dashboard-customer-pt";
import { isExcludedSalesDashboardRankingName } from "@/lib/sales-dashboard-ranking-exclude";
import { parseSalesDashboardRecordYmFromField } from "@/lib/sales-dashboard-record-date";

/**
 * APランキング。お客様情報アプリの **APPT だけ**を AP担当者ごとに合計する。
 *
 * ■ 総合PTランキングとの違い
 *   - CLPT は足さない（AP としての実績だけを見る）
 *   - 導入経緯が対象の3つ（ダイレクト・お客様紹介・(DC)工務店OBリスト）の
 *     レコードだけを数える
 * それ以外の条件は総合PT（aggregateCustomerInfoPt）と同じにしてある。
 *   - 月は**初回契約日**で判定する
 *   - 顧客ステータスがキャンセル（完全一致）のレコードは除外する
 *   - 担当者名の除外（トラーチ倶楽部・大和ハウス・卸案件）を掛ける
 *
 * ■ アポ件数タブとの違い
 * あちらはアポ情報アプリのレコード件数（aggregateApoRecords）。こちらは
 * 契約まで進んだ案件の APPT で、読むアプリも単位（件数／PT）も違う。
 * アポ件数は「アポ実績数」として隣に表示するだけで、集計には混ぜない。
 *
 * ■ 目標は使わない
 * 目標登録(月次)アプリにあるのは PT 目標（目標粗利）とアポ獲得件数で、
 * APPT に対応する目標は無い。達成率は出さず、並び順にも使わない。
 */

export type CustomerInfoApPtFieldMap = {
  /** 初回契約日 */
  date: string;
  /** 顧客ステータス。未解決ならキャンセル除外は掛からない */
  customerStatus: string | null;
  apStaff: string;
  appt: string;
  /** 導入経緯 */
  introduction: string;
};

/**
 * APランキングの集計に要る列。
 *
 * 日付・顧客ステータス・AP担当者・APPT は総合PTと**同じ列**を使う
 * （解決済みの fieldMap をそのまま受け取る）。足すのは導入経緯だけで、
 * お客様情報フォームと同じ解決関数（CUSTOMER_INFO_FIELD_INTRODUCTION →
 * 見出し「導入経緯」）を通す。新しい解決経路は作らない。
 *
 * 導入経緯を解決できなければ null。絞り込めないまま集計すると、対象外の
 * 導入経緯まで数えた数字が黙って出てしまうので、出さない側に倒す。
 */
export function resolveCustomerInfoApPtFieldMap(
  fields: AtPocketFieldRow[],
  ptFieldMap: CustomerInfoPtFieldMap,
): CustomerInfoApPtFieldMap | null {
  const introduction = resolveCustomerInfoFormFieldId(
    "introduction",
    "導入経緯",
    fields,
  );
  if (!introduction) return null;
  return {
    date: ptFieldMap.date,
    customerStatus: ptFieldMap.customerStatus,
    apStaff: ptFieldMap.apStaff,
    appt: ptFieldMap.appt,
    introduction,
  };
}

/** 対象の導入経緯か。**完全一致**（前後の空白だけ落とす） */
export function isApRankingIntroductionRoute(raw: string): boolean {
  const value = raw.trim();
  return AP_RANKING_INTRODUCTION_ROUTES.some((route) => route === value);
}

/** 数字だけを見る。「-」（未入力）は 0。総合PTの集計と同じ読み方 */
function parseNumber(raw: string): number {
  const digits = raw.replace(/[^\d]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

/** 月別の内訳を残す範囲。古い月まで出すとログが読めなくなる */
const COUNTED_BY_YM_LIMIT = 24;

/**
 * どの条件で何件落ちたかを残す。**氏名・顧客名は出さない**（件数のみ）。
 * 総合PT・アポ件数の集計内訳と同じ流儀。
 */
type ApPtCounts = {
  total: number;
  cancelled: number;
  dateUnparsed: number;
  /** AP担当者が空 */
  noName: number;
  /** 除外担当者（トラーチ倶楽部・大和ハウス・卸案件）に当たった */
  excludedName: number;
  /** 導入経緯が空 */
  introductionEmpty: number;
  /** 導入経緯が対象の3つ以外 */
  introductionOther: number;
  /** 集計に入ったレコード数 */
  counted: number;
};

/**
 * AP担当者ごと・年月ごとに APPT を積む。
 *
 * 対象月では絞らない（総合PTと同じ）。選択月も年度累計も、同じ1回の
 * 取得から sumCustomerPtMonths で取り出す。
 */
export function aggregateCustomerInfoApPt(
  records: Array<{ record?: unknown }>,
  fieldMap: CustomerInfoApPtFieldMap,
): CustomerPtMonthlyAgg {
  const byStaffMonth: CustomerPtMonthlyAgg = new Map();

  const counts: ApPtCounts = {
    total: records.length,
    cancelled: 0,
    dateUnparsed: 0,
    noName: 0,
    excludedName: 0,
    introductionEmpty: 0,
    introductionOther: 0,
    counted: 0,
  };
  const countedByYm = new Map<string, number>();

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
      continue;
    }

    const name = normApClStaffName(
      readCustomerInfoFieldValue(recObj, fieldMap.apStaff),
    );
    if (!name) {
      counts.noName += 1;
      continue;
    }
    if (isExcludedSalesDashboardRankingName(name)) {
      counts.excludedName += 1;
      continue;
    }

    const introduction = readCustomerInfoFieldValue(
      recObj,
      fieldMap.introduction,
    ).trim();
    if (!introduction) {
      counts.introductionEmpty += 1;
      continue;
    }
    if (!isApRankingIntroductionRoute(introduction)) {
      counts.introductionOther += 1;
      continue;
    }

    // CLPT は読まない。AP担当者に帰属するのは APPT だけ
    const appt = parseNumber(readCustomerInfoFieldValue(recObj, fieldMap.appt));
    const ymKey = formatYmKey(ym.year, ym.month1);

    let byMonth = byStaffMonth.get(name);
    if (!byMonth) {
      byMonth = new Map();
      byStaffMonth.set(name, byMonth);
    }
    const cur = byMonth.get(ymKey) ?? { name, pt: 0 };
    cur.pt += appt;
    byMonth.set(ymKey, cur);

    counts.counted += 1;
    countedByYm.set(ymKey, (countedByYm.get(ymKey) ?? 0) + 1);
  }

  const recent = [...countedByYm.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, COUNTED_BY_YM_LIMIT);
  console.info(
    "[sales-dashboard] APランキングの集計内訳",
    JSON.stringify({
      ...counts,
      months: countedByYm.size,
      countedByYm: Object.fromEntries(recent),
    }),
  );

  return byStaffMonth;
}

/**
 * APランキングの1行。
 *
 * ⚠ **目標・達成率の項目は持たない。** 総合PT・アポ件数の行（targetPt・
 *    targetApoCount・achievementRate）とは意図して形を変えてある。
 */
export type ApRankingRow = {
  rank: number;
  staffName: string;
  /** 期間内の APPT の合計 */
  appt: number;
  /** アポ実績数。アポ件数タブと同じ集計結果（アポ情報アプリの件数） */
  apoCount: number;
  isSelf: boolean;
  isPodium: boolean;
};

/**
 * APランキングを組み立てる。
 *
 * ■ 並び順
 *   1. APPT の高い順
 *   2. 同じならアポ実績数の多い順
 *   3. それでも同じなら氏名の五十音順（並びを安定させるため）
 *
 * ■ APPT が 0 の人は載せない（総合PT・アポ件数とは扱いが違う）
 * あちらは「実績が無くても、その月に目標がある人は載せる」。目標を並びの
 * 第2キーにしているので、0 の人同士にも順序が付くため。
 * APランキングは目標を使わない。0 の人を載せる根拠（目標）が無く、載せても
 * 並べる軸が無いので、**APPT が 0 より大きい人だけ**を載せる。
 * アポ実績数だけがある人（契約に至っていない）も載らない。
 *
 * 順位は総合PTと同じく連番（同点でも同じ順位にはしない）。
 */
export function buildApRanking(
  /** 正規化担当者名 → 期間内の APPT */
  apptByStaff: ReadonlyMap<string, number>,
  /** 正規化担当者名 → 期間内のアポ実績数。引けない担当者は 0 */
  apoCountByStaff: ReadonlyMap<string, number>,
  bound: string,
): ApRankingRow[] {
  const items: Array<{ name: string; appt: number; apoCount: number }> = [];
  apptByStaff.forEach((appt, name) => {
    if (!(appt > 0)) return;
    if (isExcludedSalesDashboardRankingName(name)) return;
    items.push({ name, appt, apoCount: apoCountByStaff.get(name) ?? 0 });
  });

  items.sort((a, b) => {
    if (a.appt !== b.appt) return b.appt - a.appt;
    if (a.apoCount !== b.apoCount) return b.apoCount - a.apoCount;
    return a.name.localeCompare(b.name, "ja");
  });

  return items.map((item, i) => ({
    rank: i + 1,
    staffName: item.name,
    appt: item.appt,
    apoCount: item.apoCount,
    isSelf: normApClStaffName(item.name) === bound,
    isPodium: i < 3,
  }));
}
