import "server-only";

import { apiKeyForAppFields, fetchAllRecordsPages, fetchAppFields } from "@/lib/atpocket";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { readCustomerInfoFieldValue } from "@/lib/customer-info-record";
import { formatYmKey } from "@/lib/fiscal-year";
import { isExcludedSalesDashboardRankingName } from "@/lib/sales-dashboard-ranking-exclude";
import { parseSalesDashboardRecordYmFromField } from "@/lib/sales-dashboard-record-date";
import {
  resolveSalesTargetFieldMap,
  salesTargetAppId,
} from "@/lib/sales-target-fields";

/**
 * 目標登録(月次)アプリから月別の目標（PT・アポ件数・支社）を引く。
 *
 * ■ 目標アプリだけを読む
 * 呼び出し元（buildSalesDashboardCore）が PT集計表・アポ取得情報・お客様情報を
 * 別途取っている。ここで他のアプリまで走査すると取得が二重になるので、
 * このファイルは目標登録(月次)だけを見る。
 *
 * ■ @pocket の往復
 * 列定義1回（30分キャッシュ・atpocket.ts の APP_FIELDS_DEFAULT_TTL_SECONDS）＋
 * レコード最大10ページ。呼び出し元の集計自体が30分キャッシュされるので、
 * 増えるのは実質「30分に1回」。
 *
 * ■ 列を増やしても往復は増えない
 * アポ件数・支社を足したが、**同じ1本の fetchAllRecordsPages に載る
 * fields の CSV が伸びるだけ**で、HTTP リクエストの本数は変わらない。
 * 対象月での絞り込みもやめて全月を積むが、取得は元から日付で絞って
 * いないので、ここでも往復は増えない。
 *
 * ■ 失敗しても投げない
 * 目標はランキングの付加情報で、これが取れないことを理由に画面を落とさない。
 * 取れなければ空で返し、呼び出し側が 0 として扱う（達成率0%・棒は空）。
 */

/** 目標アプリのページ上限。1人1ヶ月1行なので10ページ（1万行）で足りる */
const TARGET_MAX_PAGES = 10;

/** 目標値の読み方は実績側（aggregatePtRecords）と同じ。マイナス記号は落ちる */
function parseNumber(raw: string): number {
  const digits = raw.replace(/[^\d]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

/** 担当者1人・1ヶ月ぶんの目標 */
export type SalesDashboardTargetItem = {
  pt: number;
  apoCount: number;
  /** 目標アプリの「支社」列の生値。空なら名簿へフォールバックする */
  branchRaw: string;
};

export type SalesDashboardTargetLookup = {
  /** 正規化担当者名 → 年月（YYYY-MM）→ その月の目標。取れなければ空 */
  byStaffMonth: Map<string, Map<string, SalesDashboardTargetItem>>;
  /** 目標アプリを読めたか（未設定・取得失敗は false） */
  available: boolean;
};

const EMPTY: SalesDashboardTargetLookup = {
  byStaffMonth: new Map(),
  available: false,
};

/** 1ヶ月ぶんの PT 目標だけを取り出す（ランキング行の targetPt 用） */
export function pickTargetPtByStaff(
  lookup: SalesDashboardTargetLookup,
  ymKey: string,
): Map<string, number> {
  const out = new Map<string, number>();
  lookup.byStaffMonth.forEach((byMonth, name) => {
    const pt = byMonth.get(ymKey)?.pt ?? 0;
    if (pt !== 0) out.set(name, pt);
  });
  return out;
}

/** 複数月ぶんの PT 目標を足して取り出す（年度累計用） */
export function sumTargetPtByStaff(
  lookup: SalesDashboardTargetLookup,
  ymKeys: readonly string[],
): Map<string, number> {
  const out = new Map<string, number>();
  lookup.byStaffMonth.forEach((byMonth, name) => {
    let pt = 0;
    for (const ymKey of ymKeys) pt += byMonth.get(ymKey)?.pt ?? 0;
    if (pt !== 0) out.set(name, pt);
  });
  return out;
}

/** 全月を通して最後に見つかった支社の生値（担当者ごと） */
export function latestTargetBranchByStaff(
  lookup: SalesDashboardTargetLookup,
): Map<string, string> {
  const out = new Map<string, string>();
  lookup.byStaffMonth.forEach((byMonth, name) => {
    const yms = [...byMonth.keys()].sort();
    for (let i = yms.length - 1; i >= 0; i -= 1) {
      const raw = byMonth.get(yms[i]!)?.branchRaw?.trim();
      if (raw) {
        out.set(name, raw);
        return;
      }
    }
  });
  return out;
}

export async function fetchSalesDashboardPtTargets(): Promise<SalesDashboardTargetLookup> {
  const appId = salesTargetAppId();
  if (!appId) return EMPTY;

  const auth = { apiKey: apiKeyForAppFields("SALES_TARGET") };

  try {
    const fields = await fetchAppFields(appId, auth, {
      operation: "sales-dashboard:target-fields",
      appEnv: "SALES_TARGET_APP_ID",
    });
    const fieldMap = resolveSalesTargetFieldMap(fields);
    if (!fieldMap) {
      console.warn(
        "[sales-dashboard-target-lookup] 目標アプリの列を解決できません（目標は表示しません）",
      );
      return EMPTY;
    }

    // 同じ1本の取得に載せる。列を足しても HTTP の本数は変わらない
    const csv = [
      fieldMap.month,
      fieldMap.staffName,
      fieldMap.pt,
      fieldMap.apoCount,
      fieldMap.branch,
    ].join(",");
    const records = await fetchAllRecordsPages(
      appId,
      csv,
      auth,
      null,
      {
        operation: "sales-dashboard:target-records",
        appEnv: "SALES_TARGET_APP_ID",
      },
      { maxPages: TARGET_MAX_PAGES, maxRetries: 1 },
    );

    const byStaffMonth = new Map<
      string,
      Map<string, SalesDashboardTargetItem>
    >();
    for (const row of records) {
      const rec = row.record;
      if (!rec || typeof rec !== "object") continue;
      const recObj = rec as Record<string, unknown>;

      // 対象月では絞らない。全月を積んで、選ぶのは呼び出し側
      const ym = parseSalesDashboardRecordYmFromField(recObj, fieldMap.month);
      if (!ym) continue;

      const name = normApClStaffName(
        readCustomerInfoFieldValue(recObj, fieldMap.staffName),
      );
      // 実績側と同じ除外を掛ける。片側だけ除外すると達成率が歪む
      if (!name || isExcludedSalesDashboardRankingName(name)) continue;

      const ymKey = formatYmKey(ym.year, ym.month1);
      let byMonth = byStaffMonth.get(name);
      if (!byMonth) {
        byMonth = new Map();
        byStaffMonth.set(name, byMonth);
      }

      const cur = byMonth.get(ymKey) ?? { pt: 0, apoCount: 0, branchRaw: "" };
      // 同じ人に複数行あるときは合算する（営業進捗の集計と同じ扱い）
      cur.pt += parseNumber(readCustomerInfoFieldValue(recObj, fieldMap.pt));
      cur.apoCount += parseNumber(
        readCustomerInfoFieldValue(recObj, fieldMap.apoCount),
      );
      // 支社は合算できない。最後に入っていた値を残す
      const branchRaw = readCustomerInfoFieldValue(
        recObj,
        fieldMap.branch,
      ).trim();
      if (branchRaw) cur.branchRaw = branchRaw;
      byMonth.set(ymKey, cur);
    }

    return { byStaffMonth, available: true };
  } catch (e) {
    console.warn(
      "[sales-dashboard-target-lookup] 目標の取得に失敗しました（目標は表示しません）",
      e instanceof Error ? e.message : String(e),
    );
    return EMPTY;
  }
}
