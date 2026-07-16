import "server-only";

import type { AtPocketFetchAuth } from "@/lib/atpocket";
import {
  apiKeyForAppFields,
  listAuthsForAppList,
} from "@/lib/atpocket";

export function bulletinAppId(): string | null {
  const id = process.env.BULLETIN_APP_ID?.trim();
  return id || null;
}

/** fields 取得用の読取キー（未設定時は読取①） */
export function bulletinFieldAuth(): AtPocketFetchAuth {
  return { apiKey: apiKeyForAppFields("BULLETIN") };
}

/** 一覧読取（429 時のサブキーフェイルオーバー対応） */
export function bulletinListAuths(): AtPocketFetchAuth[] {
  return listAuthsForAppList("BULLETIN");
}

/** 投稿（書き込み）用キー。更新③（_2）優先、無ければ読取①で代用 */
export function bulletinWriteAuth(): AtPocketFetchAuth {
  const apiKey =
    process.env.BULLETIN_ATPOCKET_API_KEY_2?.trim() ||
    process.env.BULLETIN_ATPOCKET_API_KEY?.trim();
  return { apiKey: apiKey || undefined };
}

export function bulletinConfigReady():
  | { ok: true; appId: string }
  | { ok: false; error: string } {
  const appId = bulletinAppId();
  if (!appId) {
    return { ok: false, error: "BULLETIN_APP_ID が未設定です" };
  }
  const readKey =
    process.env.BULLETIN_ATPOCKET_API_KEY?.trim() ||
    process.env.BULLETIN_ATPOCKET_API_KEY_1?.trim();
  if (!readKey) {
    return {
      ok: false,
      error: "BULLETIN_ATPOCKET_API_KEY（読取用）が未設定です",
    };
  }
  return { ok: true, appId };
}
