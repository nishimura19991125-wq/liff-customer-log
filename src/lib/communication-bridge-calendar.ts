import "server-only";

import {
  fetchAppFieldsTryKeys,
  fetchAppIdByNameTryKeys,
  readAuthsForCommunicationBridgeCalendar,
} from "@/lib/atpocket";

/** @pocket 管理画面のアプリ名 */
export const COMMUNICATION_BRIDGE_CALENDAR_APP_NAME =
  "コミュニケーションブリッジカレンダー";

let resolvedAppIdCache: string | null = null;

export function communicationBridgeCalendarAppIdFromEnv(): string {
  return process.env.COMMUNICATION_BRIDGE_CALENDAR_APP_ID?.trim() ?? "";
}

function communicationBridgeCalendarApiKeys(): string[] {
  return readAuthsForCommunicationBridgeCalendar()
    .map((auth) => auth.apiKey?.trim())
    .filter((key): key is string => Boolean(key));
}

export async function resolveCommunicationBridgeCalendarAppId(): Promise<{
  appId: string | null;
  error?: string;
}> {
  const fromEnv = communicationBridgeCalendarAppIdFromEnv();
  if (fromEnv) return { appId: fromEnv };
  if (resolvedAppIdCache) return { appId: resolvedAppIdCache };

  const apiKeys = communicationBridgeCalendarApiKeys();
  if (apiKeys.length === 0) {
    return {
      appId: null,
      error:
        "COMMUNICATION_BRIDGE_CALENDAR_1 が未設定です。Netlify の環境変数を確認してください。",
    };
  }

  const lookedUp = await fetchAppIdByNameTryKeys(
    COMMUNICATION_BRIDGE_CALENDAR_APP_NAME,
    apiKeys,
  );
  if (lookedUp) {
    resolvedAppIdCache = lookedUp;
    return { appId: lookedUp };
  }

  return {
    appId: null,
    error: `アプリ「${COMMUNICATION_BRIDGE_CALENDAR_APP_NAME}」の ID を取得できませんでした。COMMUNICATION_BRIDGE_CALENDAR_APP_ID を設定するか、API キーの参照権限を確認してください。`,
  };
}

export async function verifyCommunicationBridgeCalendarApiAccess(): Promise<{
  ok: boolean;
  appId?: string;
  error?: string;
}> {
  const resolved = await resolveCommunicationBridgeCalendarAppId();
  if (!resolved.appId) {
    return { ok: false, error: resolved.error };
  }

  const apiKeys = communicationBridgeCalendarApiKeys();
  if (apiKeys.length === 0) {
    return {
      ok: false,
      error:
        "COMMUNICATION_BRIDGE_CALENDAR_1 が未設定です。Netlify の環境変数を確認してください。",
    };
  }

  const fields = await fetchAppFieldsTryKeys(resolved.appId, apiKeys);
  if (fields) {
    return { ok: true, appId: resolved.appId };
  }

  return {
    ok: false,
    appId: resolved.appId,
    error:
      "コミュニケーションブリッジカレンダーへの API 接続に失敗しました。COMMUNICATION_BRIDGE_CALENDAR_1（〜_7）の権限を確認してください。",
  };
}
