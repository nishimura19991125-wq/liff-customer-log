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

/** GET /api/communication-bridge/calendar のキャッシュキー */
export function buildCommunicationBridgeCalendarPayloadCacheKey(
  year: number,
  month: number,
  appId: string,
): string {
  const extraRaw =
    process.env.COMMUNICATION_BRIDGE_CALENDAR_EXTRA_HOLIDAYS?.trim() ??
    process.env.CALENDAR_EXTRA_HOLIDAYS?.trim();
  const extraHolidayKeys = extraRaw
    ? extraRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const includeSandwich =
    process.env.COMMUNICATION_BRIDGE_CALENDAR_INCLUDE_SANDWICH_NATIONAL_HOLIDAY?.trim() ===
      "true" ||
    process.env.CALENDAR_INCLUDE_SANDWICH_NATIONAL_HOLIDAY?.trim() === "true";
  const recordsQueryFilterEnabled =
    process.env.COMMUNICATION_BRIDGE_CALENDAR_RECORDS_QUERY_FILTER?.trim() ===
    "true";

  return JSON.stringify({
    v: 8,
    appId,
    attachmentField:
      process.env.COMMUNICATION_BRIDGE_CALENDAR_ATTACHMENT_FIELD_ID?.trim() ??
      "",
    startDateField:
      process.env.COMMUNICATION_BRIDGE_CALENDAR_START_DATE_FIELD_ID?.trim() ??
      "",
    extra: extraHolidayKeys.slice().sort().join(","),
    sandwich: includeSandwich,
    recordsQueryFilter: recordsQueryFilterEnabled,
    year,
    month,
  });
}

export function communicationBridgeCalendarCacheTtlMs(): number {
  const raw =
    process.env.COMMUNICATION_BRIDGE_CALENDAR_RESPONSE_CACHE_SECONDS?.trim() ??
    process.env.CALENDAR_RESPONSE_CACHE_SECONDS?.trim();
  const sec = raw ? Number(raw) : 120;
  if (!Number.isFinite(sec)) return 120_000;
  const clamped = Math.min(600, Math.max(30, sec));
  return clamped * 1000;
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
      "コミュニケーションブリッジへの API 接続に失敗しました。COMMUNICATION_BRIDGE_CALENDAR_1（〜_7）の権限を確認してください。",
  };
}
