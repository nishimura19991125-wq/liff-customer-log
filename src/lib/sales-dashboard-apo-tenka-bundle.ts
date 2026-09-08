import "server-only";
import { safePocketErrorText } from "@/lib/api-error-response";

import { apiKeyForAppFields, fetchAppFields, type AtPocketFieldRow } from "@/lib/atpocket";
import { fieldCaptionByUniqueId } from "@/lib/customer-info-record";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import {
  aggregateApoRecords,
  type ApoDashboardRankingRow,
  type ApoMonthlyAgg,
} from "@/lib/sales-dashboard-apo-aggregate";
import {
  aggregateTenkaRecords,
  type TenkaAggItem,
  type TenkaMonthlyAgg,
} from "@/lib/sales-dashboard-tenka-aggregate";
import {
  resolveApoDashboardFieldMap,
  resolveApoTenkaFieldMap,
  salesDashboardApoAppId,
  salesDashboardApoTenkaTypeFilterValues,
  salesDashboardApoTypeFilterValues,
  type ApoDashboardFieldMap,
} from "@/lib/sales-dashboard-fields";
import {
  fetchSalesDashboardRecordPages,
  salesDashboardApoListAuths,
} from "@/lib/sales-dashboard-list-fetch";
import { isExcludedSalesDashboardRankingName } from "@/lib/sales-dashboard-ranking-exclude";

/** AP天下賞の並び。呼び出し側が月ごとに掛け直す */
export function sortTenkaAgg(items: TenkaAggItem[]): TenkaAggItem[] {
  const visible = items.filter(
    (it) => !isExcludedSalesDashboardRankingName(it.name),
  );
  return [...visible].sort(
    (a, b) =>
      b.targetCount - a.targetCount ||
      a.name.localeCompare(b.name, "ja"),
  );
}

/** AP天下賞のランキング行。呼び出し側が月ごとに掛け直す */
export function buildTenkaRanking(
  sorted: TenkaAggItem[],
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

/**
 * アポ件数が実際に読んでいる列を1回だけ残す。
 *
 * 列は環境変数（SALES_DASHBOARD_APO_*_FIELD_ID）か見出しのどちらかで
 * 解決する。環境変数を使う経路は uniqueId がスキーマに在るかしか見ず、
 * 見出しとは照合しない（resolveConfiguredFieldToSchemaUniqueId）。
 * @pocket 側で列を作り替えて同じ uniqueId が別の意味になっていても
 * 黙って通るので、掴んだ列の見出しを残しておかないと気づけない。
 *
 * 出すのは列の uniqueId と見出しだけで、レコードの中身は出さない。
 *
 * negotiationStatus はアポキャンを判定する列。環境変数名が
 * SALES_DASHBOARD_APO_STATUS_FIELD_ID なのは、以前これを見積ステータスだと
 * 思っていた名残り。実体は商談ステータスで、変数名だけ実態に合わせてある。
 */
function logResolvedApoFields(
  fieldMap: ApoDashboardFieldMap,
  fields: AtPocketFieldRow[],
): void {
  const describe = (id: string | null) =>
    id ? { id, caption: fieldCaptionByUniqueId(fields, id) } : null;

  console.info(
    "[sales-dashboard] アポ件数が読む列",
    JSON.stringify({
      date: describe(fieldMap.date),
      salesperson: describe(fieldMap.salesperson),
      apoType: describe(fieldMap.apoType),
      negotiationStatus: describe(fieldMap.negotiationStatus),
    }),
  );
}

/**
 * 月別に積んだアポ・AP天下賞。**月の選択はここではしない。**
 * 呼び出し側（sales-dashboard-data.ts）が選択月・年度累計で取り出す。
 */
export type ApoTenkaMonthlyBundle = {
  apo:
    | { ok: true; byStaffMonth: ApoMonthlyAgg }
    | { ok: false; error: string };
  tenka:
    | { ok: true; byStaffMonth: TenkaMonthlyAgg }
    | { ok: false; error: string };
};

/**
 * アポ件数・AP天下賞を同一の fields / records 取得で集計（@pocket 呼び出しを約半減）。
 *
 * 取得は元から日付で絞っていないので、月別に積んでも**問い合わせは増えない**。
 * 1回の取得結果から過去月も年度累計も作れる。
 */
export async function buildApoAndTenkaMonthly(): Promise<ApoTenkaMonthlyBundle> {
  const apoAppId = salesDashboardApoAppId();
  if (!apoAppId) {
    const err = "SALES_DASHBOARD_APO_APP_ID が未設定です";
    return {
      apo: { ok: false, error: err },
      tenka: { ok: false, error: err },
    };
  }

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

    logResolvedApoFields(apoFieldMap, apoFields);

    const tenkaFieldError =
      "AP天下賞の必須フィールド（AP担当者・アポ種別・日付・片クロor両クロ・商談場所・商談化リードタイム）の特定に失敗しました";

    const wantedIds = new Set<string>();
    for (const id of [
      apoFieldMap.salesperson,
      apoFieldMap.apoType,
      apoFieldMap.date,
      apoFieldMap.negotiationStatus,
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

    return {
      apo: {
        ok: true,
        byStaffMonth: aggregateApoRecords(
          records,
          apoFieldMap,
          apoFilterValues,
        ),
      },
      tenka: tenkaFieldMap
        ? {
            ok: true,
            byStaffMonth: aggregateTenkaRecords(
              records,
              tenkaFieldMap,
              tenkaFilterValues,
            ),
          }
        : { ok: false, error: tenkaFieldError },
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
