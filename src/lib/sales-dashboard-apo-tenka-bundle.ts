import "server-only";
import { safePocketErrorText } from "@/lib/api-error-response";

import { apiKeyForAppFields, fetchAppFields } from "@/lib/atpocket";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import {
  aggregateApoRecords,
  buildApoRanking,
  sortApoAgg,
  type ApoDashboardRankingRow,
  type ApoDashboardSectionResult,
} from "@/lib/sales-dashboard-apo-aggregate";
import {
  aggregateTenkaRecords,
  type TenkaDashboardKpi,
  type TenkaDashboardSectionResult,
} from "@/lib/sales-dashboard-tenka-aggregate";
import {
  resolveApoDashboardFieldMap,
  resolveApoTenkaFieldMap,
  salesDashboardApoAppId,
  salesDashboardApoTenkaTypeFilterValues,
  salesDashboardApoTypeFilterValues,
} from "@/lib/sales-dashboard-fields";
import {
  fetchSalesDashboardRecordPages,
  salesDashboardApoListAuths,
} from "@/lib/sales-dashboard-list-fetch";
import type { SalesDashboardPeriodKey } from "@/lib/sales-dashboard-period";
import { isExcludedSalesDashboardRankingName } from "@/lib/sales-dashboard-ranking-exclude";

function sortTenkaAgg(
  items: Array<{ name: string; targetCount: number }>,
): Array<{ name: string; targetCount: number }> {
  const visible = items.filter(
    (it) => !isExcludedSalesDashboardRankingName(it.name),
  );
  return [...visible].sort(
    (a, b) =>
      b.targetCount - a.targetCount ||
      a.name.localeCompare(b.name, "ja"),
  );
}

function buildTenkaRanking(
  sorted: Array<{ name: string; targetCount: number }>,
  total: number,
  bound: string,
): ApoDashboardRankingRow[] {
  return sorted.map((item, i) => ({
    rank: i + 1,
    staffName: item.name,
    apoCount: item.targetCount,
    sharePercent:
      total > 0 ? Math.round((item.targetCount / total) * 1000) / 10 : 0,
    isSelf: normApClStaffName(item.name) === bound,
    isPodium: i < 3,
  }));
}

export type ApoTenkaBundleResult = {
  apo: ApoDashboardSectionResult;
  tenka: TenkaDashboardSectionResult;
};

/**
 * アポ件数・AP天下賞を同一の fields / records 取得で集計（@pocket 呼び出しを約半減）。
 */
export async function buildApoAndTenkaSections(
  boundStaffName: string,
  periodKey: SalesDashboardPeriodKey,
): Promise<ApoTenkaBundleResult> {
  const apoAppId = salesDashboardApoAppId();
  if (!apoAppId) {
    const err = "SALES_DASHBOARD_APO_APP_ID が未設定です";
    return {
      apo: { ok: false, error: err },
      tenka: { ok: false, error: err },
    };
  }

  const bound = normApClStaffName(boundStaffName);
  const apoFilterValues = salesDashboardApoTypeFilterValues();
  const tenkaFilterValues = salesDashboardApoTenkaTypeFilterValues();

  try {
    const fieldAuth = { apiKey: apiKeyForAppFields("SALES_DASHBOARD_APO") };
    const apoFields = await fetchAppFields(apoAppId, fieldAuth, {
      operation: "sales-dashboard:apo-tenka-fields",
      appEnv: "SALES_DASHBOARD_APO_APP_ID",
    });

    const apoFieldMap = resolveApoDashboardFieldMap(apoFields);
    const tenkaFieldMap = resolveApoTenkaFieldMap(apoFields);

    if (!apoFieldMap) {
      const err =
        "必須フィールド（AP担当者・アポ種別・日付）の特定に失敗しました。SALES_DASHBOARD_APO_*_FIELD_ID で uniqueId を指定してください";
      return {
        apo: { ok: false, error: err },
        tenka: { ok: false, error: err },
      };
    }

    const tenkaFieldError =
      "AP天下賞の必須フィールド（AP担当者・アポ種別・日付・片クロor両クロ・商談場所・商談化リードタイム）の特定に失敗しました";

    const wantedIds = new Set<string>();
    for (const id of [
      apoFieldMap.salesperson,
      apoFieldMap.apoType,
      apoFieldMap.date,
      apoFieldMap.estimateStatus,
      ...(tenkaFieldMap
        ? [
            tenkaFieldMap.closeType,
            tenkaFieldMap.meetingPlace,
            tenkaFieldMap.leadTime,
          ]
        : []),
    ]) {
      if (id) wantedIds.add(id);
    }
    const wanted = [...wantedIds].join(",");

    const records = await fetchSalesDashboardRecordPages(
      apoAppId,
      wanted,
      salesDashboardApoListAuths(),
      {
        operation: "sales-dashboard:apo-tenka-records",
        appEnv: "SALES_DASHBOARD_APO_APP_ID",
      },
    );

    const apoByStaff = aggregateApoRecords(
      records,
      apoFieldMap,
      periodKey,
      apoFilterValues,
    );
    const apoSorted = sortApoAgg([...apoByStaff.values()]);
    const totalApo = apoSorted.reduce((s, x) => s + x.apoCount, 0);

    let tenka: TenkaDashboardSectionResult;
    if (!tenkaFieldMap) {
      tenka = { ok: false, error: tenkaFieldError };
    } else {
      const tenkaByStaff = aggregateTenkaRecords(
        records,
        tenkaFieldMap,
        periodKey,
        tenkaFilterValues,
      );
      const tenkaSorted = sortTenkaAgg([...tenkaByStaff.values()]);
      const totalTenka = tenkaSorted.reduce((s, x) => s + x.targetCount, 0);
      tenka = {
        ok: true,
        kpi: { totalTargetCount: totalTenka },
        ranking: buildTenkaRanking(tenkaSorted, totalTenka, bound),
      };
    }

    return {
      apo: {
        ok: true,
        kpi: { totalApoCount: totalApo },
        ranking: buildApoRanking(apoSorted, totalApo, bound),
      },
      tenka,
    };
  } catch (e) {
    /**
     * まとめ取りが丸ごと失敗した経路。**同じ文言を両方へ渡す。**
     *
     * ここも apoError / tenkaError にそのまま載るので、各集計の catch と
     * 同じように遮蔽する。片方だけ直しても、この経路から生メッセージが
     * 画面へ出てしまう。
     */
    const fallback = safePocketErrorText(e, {
      scope: "sales-dashboard:apo-tenka",
      message: "アポ件数ランキングの取得に失敗しました",
    });
    return {
      apo: { ok: false, error: fallback },
      tenka: { ok: false, error: fallback },
    };
  }
}
