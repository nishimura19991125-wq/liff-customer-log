import "server-only";

import {
  fetchAppFieldsTryKeys,
  readAuthsForCommunicationBridgeCalendar,
} from "@/lib/atpocket";

/** @pocket 管理画面のアプリ名 */
export const COMMUNICATION_BRIDGE_CALENDAR_APP_NAME =
  "コミュニケーションブリッジカレンダー";

export function communicationBridgeCalendarAppIdFromEnv(): string {
  return process.env.COMMUNICATION_BRIDGE_CALENDAR_APP_ID?.trim() ?? "";
}

export async function verifyCommunicationBridgeCalendarApiAccess(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const appId = communicationBridgeCalendarAppIdFromEnv();
  if (!appId) {
    return {
      ok: false,
      error: "COMMUNICATION_BRIDGE_CALENDAR_APP_ID が未設定です",
    };
  }

  const apiKeys = readAuthsForCommunicationBridgeCalendar()
    .map((auth) => auth.apiKey?.trim())
    .filter((key): key is string => Boolean(key));

  if (apiKeys.length === 0) {
    return {
      ok: false,
      error: "COMMUNICATION_BRIDGE_CALENDAR_1 を設定してください",
    };
  }

  const fields = await fetchAppFieldsTryKeys(appId, apiKeys);
  if (fields) {
    return { ok: true };
  }

  return {
    ok: false,
    error:
      "コミュニケーションブリッジカレンダーの API 接続に失敗しました。COMMUNICATION_BRIDGE_CALENDAR_APP_ID と COMMUNICATION_BRIDGE_CALENDAR_1（〜_7）の権限を確認してください。",
  };
}
