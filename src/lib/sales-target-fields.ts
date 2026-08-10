import "server-only";

import { apiKeyForAppFields, type AtPocketFieldRow } from "@/lib/atpocket";
import {
  pocketFieldUniqueIdByCaption,
  resolveConfiguredFieldToSchemaUniqueId,
} from "@/lib/calendar-kojo";
import {
  parseSalesProgressVisibleBranches,
  SALES_PROGRESS_DEFAULT_OTHER_BRANCH_LABEL,
  type SalesProgressBranchConfig,
} from "@/lib/sales-progress-branch";

/**
 * 目標登録(月次)アプリ（appId 20）の設定（タスクK）。
 *
 * 環境変数で uniqueId を指定できるが、未設定でも見出しの完全一致で解決する
 * （既存の各アプリと同じ方式）。調査ルートの出力で、全列が見出し完全一致で
 * 解決できることを確認済み。
 *
 * 成約件数・稼働予定日数・平均粗利は今回使わないため解決しない。
 */

/** 調査で確認した見出し。環境変数が未設定のときはこれで解決する */
const TARGET_CAPTIONS = {
  month: "目標月",
  department: "部署",
  branch: "支社",
  staffName: "担当者名",
  apoCount: "アポ獲得件数",
  pt: "目標粗利",
} as const;

export type SalesTargetFieldMap = {
  month: string;
  branch: string;
  staffName: string;
  apoCount: string;
  pt: string;
  /** 今回は集計に使わないが、解決できたら参照だけする */
  department: string | null;
};

function pickByEnvOrCaption(
  envKey: string,
  fields: AtPocketFieldRow[],
  caption: string,
): string | null {
  const env = process.env[envKey]?.trim();
  if (env) {
    const id = resolveConfiguredFieldToSchemaUniqueId(env, fields);
    if (id) return id;
  }
  return pocketFieldUniqueIdByCaption(fields, caption);
}

export function resolveSalesTargetFieldMap(
  fields: AtPocketFieldRow[],
): SalesTargetFieldMap | null {
  const month = pickByEnvOrCaption(
    "SALES_TARGET_MONTH_FIELD_ID",
    fields,
    TARGET_CAPTIONS.month,
  );
  const branch = pickByEnvOrCaption(
    "SALES_TARGET_BRANCH_FIELD_ID",
    fields,
    TARGET_CAPTIONS.branch,
  );
  const staffName = pickByEnvOrCaption(
    "SALES_TARGET_STAFF_NAME_FIELD_ID",
    fields,
    TARGET_CAPTIONS.staffName,
  );
  const apoCount = pickByEnvOrCaption(
    "SALES_TARGET_APO_COUNT_FIELD_ID",
    fields,
    TARGET_CAPTIONS.apoCount,
  );
  const pt = pickByEnvOrCaption(
    "SALES_TARGET_PT_FIELD_ID",
    fields,
    TARGET_CAPTIONS.pt,
  );
  const department = pickByEnvOrCaption(
    "SALES_TARGET_DEPARTMENT_FIELD_ID",
    fields,
    TARGET_CAPTIONS.department,
  );

  if (!month || !branch || !staffName || !apoCount || !pt) return null;
  return { month, branch, staffName, apoCount, pt, department };
}

/** 調査ルート（/api/_probe/sales-target）で設定済みの変数をそのまま使う */
export function salesTargetAppId(): string | null {
  return process.env.SALES_TARGET_APP_ID?.trim() || null;
}

export function salesTargetPocketAuth(): { apiKey: string } {
  return { apiKey: apiKeyForAppFields("SALES_TARGET") };
}

/** 表示する支社と、それ以外の寄せ先 */
export function salesProgressBranchConfig(): SalesProgressBranchConfig {
  return {
    visibleBranches: parseSalesProgressVisibleBranches(
      process.env.SALES_PROGRESS_VISIBLE_BRANCHES,
    ),
    otherLabel:
      process.env.SALES_PROGRESS_OTHER_BRANCH_LABEL?.trim() ||
      SALES_PROGRESS_DEFAULT_OTHER_BRANCH_LABEL,
  };
}
