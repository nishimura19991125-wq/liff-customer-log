import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import {
  pocketFieldUniqueIdByCaption,
  resolveConfiguredFieldToSchemaUniqueId,
} from "@/lib/calendar-kojo";

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

function pickByKeywords(
  fields: AtPocketFieldRow[],
  keywords: string[],
): string | null {
  const lowered = keywords.map((k) => nfkc(k).toLowerCase()).filter(Boolean);
  for (const f of fields) {
    const cap = f.caption ? nfkc(String(f.caption)).toLowerCase() : "";
    if (!cap) continue;
    if (lowered.some((k) => cap.includes(k))) {
      const id = f.uniqueId?.trim();
      if (id) return id;
    }
  }
  return null;
}

function pickByEnvOrKeywords(
  envKey: string,
  fields: AtPocketFieldRow[],
  keywords: string[],
  exactCaptions: string[] = [],
): string | null {
  const env = process.env[envKey]?.trim();
  if (env) {
    const id = resolveConfiguredFieldToSchemaUniqueId(env, fields);
    if (id) return id;
  }
  for (const cap of exactCaptions) {
    const id = pocketFieldUniqueIdByCaption(fields, cap);
    if (id) return id;
  }
  return pickByKeywords(fields, keywords);
}

export type PtDashboardFieldMap = {
  salesperson: string;
  pt: string | null;
  sales: string | null;
  date: string;
};

export function resolvePtDashboardFieldMap(
  fields: AtPocketFieldRow[],
): PtDashboardFieldMap | null {
  const salesperson = pickByEnvOrKeywords(
    "SALES_DASHBOARD_PT_SALESPERSON_FIELD_ID",
    fields,
    ["営業担当", "担当者", "担当", "営業", "AP", "クローザー", "CL"],
  );
  const date = pickByEnvOrKeywords(
    "SALES_DASHBOARD_PT_DATE_FIELD_ID",
    fields,
    ["計上日", "契約日", "日付", "実績日", "売上日", "登録日", "PT加算日"],
  );
  if (!salesperson || !date) return null;

  const pt = pickByEnvOrKeywords(
    "SALES_DASHBOARD_PT_PT_FIELD_ID",
    fields,
    ["PT", "ポイント", "point", "pt"],
  );
  const sales = pickByEnvOrKeywords(
    "SALES_DASHBOARD_PT_SALES_FIELD_ID",
    fields,
    ["売上", "金額", "受注金額", "契約金額", "税込", "税抜", "販売単価"],
  );

  return { salesperson, pt, sales, date };
}

export type ContractCountFieldMap = {
  date: string;
  clPerson: string;
  customerStatus: string | null;
};

export function resolveContractCountFieldMap(
  fields: AtPocketFieldRow[],
): ContractCountFieldMap | null {
  const date = pickByEnvOrKeywords(
    "SALES_DASHBOARD_CONTRACT_DATE_FIELD_ID",
    fields,
    ["初回契約日", "日付", "計上日", "実績日", "登録日"],
    ["初回契約日"],
  );
  const clPerson = pickByEnvOrKeywords(
    "SALES_DASHBOARD_CONTRACT_CL_FIELD_ID",
    fields,
    ["CL担当者", "CL 担当者"],
    ["CL担当者"],
  );
  if (!date || !clPerson) return null;

  const customerStatus = pickByEnvOrKeywords(
    "SALES_DASHBOARD_CONTRACT_STATUS_FIELD_ID",
    fields,
    ["顧客ステータス", "顧客ｽﾃｰﾀｽ", "顧客状態", "ステータス"],
    ["顧客ステータス"],
  );

  return { date, clPerson, customerStatus };
}

export function salesDashboardPtAppId(): string | null {
  return (
    process.env.SALES_DASHBOARD_PT_APP_ID?.trim() ||
    process.env.SALES_DASHBOARD_APP_ID?.trim() ||
    null
  );
}

export function salesDashboardContractAppId(): string | null {
  return (
    process.env.SALES_DASHBOARD_CONTRACT_APP_ID?.trim() ||
    process.env.CUSTOMER_INFO_APP_ID?.trim() ||
    null
  );
}

export type ApoDashboardFieldMap = {
  salesperson: string;
  apoType: string;
  date: string;
  estimateStatus: string;
};

function pickApoSalespersonFieldId(fields: AtPocketFieldRow[]): string | null {
  const env = process.env.SALES_DASHBOARD_APO_SALESPERSON_FIELD_ID?.trim();
  if (env) {
    const id = resolveConfiguredFieldToSchemaUniqueId(env, fields);
    if (id) return id;
  }
  for (const cap of ["AP担当者", "AP 担当者"]) {
    const id = pocketFieldUniqueIdByCaption(fields, cap);
    if (id) return id;
  }
  for (const cap of ["アポインター", "アポ担当者", "AP担当"]) {
    const id = pickByKeywords(fields, [cap]);
    if (id) return id;
  }
  return pickByKeywords(fields, [
    "AP担当者",
    "AP 担当者",
    "担当者",
    "営業担当",
    "AP",
  ]);
}

function pickApoDateFieldId(fields: AtPocketFieldRow[]): string | null {
  const env = process.env.SALES_DASHBOARD_APO_DATE_FIELD_ID?.trim();
  if (env) {
    const id = resolveConfiguredFieldToSchemaUniqueId(env, fields);
    if (id) return id;
  }
  for (const cap of ["アポ取得日", "初回商談実施日"]) {
    const id = pocketFieldUniqueIdByCaption(fields, cap);
    if (id) return id;
  }
  return pickByKeywords(fields, [
    "アポ取得日",
    "アポ日",
    "取得日",
    "初回商談実施日",
    "日付",
    "登録日",
  ]);
}

export function resolveApoDashboardFieldMap(
  fields: AtPocketFieldRow[],
): ApoDashboardFieldMap | null {
  const salesperson = pickApoSalespersonFieldId(fields);
  const apoType = pickByEnvOrKeywords(
    "SALES_DASHBOARD_APO_TYPE_FIELD_ID",
    fields,
    ["アポ種別", "アポタイプ", "種別"],
    ["アポ種別"],
  );
  const date = pickApoDateFieldId(fields);
  const estimateStatus = pickByEnvOrKeywords(
    "SALES_DASHBOARD_APO_STATUS_FIELD_ID",
    fields,
    ["見積ステータス", "見積ｽﾃｰﾀｽ", "見積ステータス区分"],
    ["見積ステータス"],
  );
  if (!salesperson || !apoType || !date || !estimateStatus) return null;
  return { salesperson, apoType, date, estimateStatus };
}

/** アポ種別フィルタ（部分一致）。未設定時は ranking_pt_dashboard.config.js 既定相当 */
export function salesDashboardApoTypeFilterValues(): string[] {
  const raw = process.env.SALES_DASHBOARD_APO_TYPE_FILTER_VALUES?.trim();
  const defaults = ["ダイレクト", "お客様紹介", "(DC)工務店OBリスト"];
  if (!raw) return defaults;
  const parsed = raw
    .split(",")
    .map((s) => nfkc(s))
    .filter(Boolean);
  return parsed.length ? parsed : defaults;
}

export function salesDashboardApoAppId(): string | null {
  return process.env.SALES_DASHBOARD_APO_APP_ID?.trim() || null;
}
