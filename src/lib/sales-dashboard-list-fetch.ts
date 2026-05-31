import "server-only";

import {
  fetchAllRecordsPages,
  listAuthsForAppList,
  type AtPocketFetchAuth,
  type AtPocketRecordRow,
} from "@/lib/atpocket";
import { customerInfoDashboardListAuths } from "@/lib/customer-info-config";

const PAGE_LIMIT = 1000;
const DEFAULT_MAX_PAGES = 25;

function dashboardMaxPages(): number {
  const raw = process.env.SALES_DASHBOARD_MAX_PAGES?.trim();
  const n = raw ? Number(raw) : DEFAULT_MAX_PAGES;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_PAGES;
  return Math.min(50, Math.floor(n));
}


/** 営業ダッシュボード用レコード一覧（ページごとにキーローテーション・429時の再試行は抑える） */
export async function fetchSalesDashboardRecordPages(
  appId: string,
  fieldsCsv: string,
  listAuths: AtPocketFetchAuth[],
  ctx: { operation: string; appEnv: string },
): Promise<AtPocketRecordRow[]> {
  const auths =
    listAuths.filter((a) => a.apiKey?.trim()).length > 0
      ? listAuths.filter((a) => a.apiKey?.trim())
      : listAuths;
  return fetchAllRecordsPages(appId, fieldsCsv, auths[0], null, ctx, {
    maxPages: dashboardMaxPages(),
    authKeys: auths,
    maxRetries: 1,
  });
}

export function salesDashboardPtListAuths(): AtPocketFetchAuth[] {
  return listAuthsForAppList("SALES_DASHBOARD_PT");
}

export function salesDashboardApoListAuths(): AtPocketFetchAuth[] {
  return listAuthsForAppList("SALES_DASHBOARD_APO");
}

export {
  customerInfoDashboardListAuths as customerInfoListAuths,
  PAGE_LIMIT,
};
