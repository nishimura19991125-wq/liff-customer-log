import "server-only";

import {
  fetchAppIdByNameTryKeys,
  readAuthsForApp,
} from "@/lib/atpocket";

/** @pocket 管理画面のアプリ名 */
export const WORK_END_REPORT_APP_NAME = "稼働終了報告";

let resolvedAppIdCache: string | null = null;

export function workEndReportAppIdFromEnv(): string {
  return process.env.WORK_END_REPORT_APP_ID?.trim() ?? "";
}

function workEndReportApiKeys(): string[] {
  return readAuthsForApp("WORK_END_REPORT")
    .map((auth) => auth.apiKey?.trim())
    .filter((key): key is string => Boolean(key));
}

export async function resolveWorkEndReportAppId(): Promise<{
  appId: string | null;
  error?: string;
}> {
  const fromEnv = workEndReportAppIdFromEnv();
  if (fromEnv) return { appId: fromEnv };
  if (resolvedAppIdCache) return { appId: resolvedAppIdCache };

  const apiKeys = workEndReportApiKeys();
  if (apiKeys.length === 0) {
    return {
      appId: null,
      error:
        "WORK_END_REPORT_ATPOCKET_API_KEY が未設定です。Netlify の環境変数を確認してください。",
    };
  }

  const lookedUp = await fetchAppIdByNameTryKeys(
    WORK_END_REPORT_APP_NAME,
    apiKeys,
  );
  if (lookedUp) {
    resolvedAppIdCache = lookedUp;
    return { appId: lookedUp };
  }

  return {
    appId: null,
    error: `アプリ「${WORK_END_REPORT_APP_NAME}」の ID を取得できませんでした。WORK_END_REPORT_APP_ID を設定するか、API キーの参照権限を確認してください。`,
  };
}
