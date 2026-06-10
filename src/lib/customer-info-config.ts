import "server-only";

import type { AtPocketFetchAuth } from "@/lib/atpocket";
import {
  apiKeyForAppFields,
  apiKeyForCustomerInfoPocket,
  apiKeyForCustomerInfoPocket1,
  apiKeyForCustomerInfoWrite,
  listAuthsForAppList,
  POCKET_LIST_SUB_KEY_MAX,
} from "@/lib/atpocket";

export function customerInfoAppId(): string | null {
  const id = process.env.CUSTOMER_INFO_APP_ID?.trim();
  return id || null;
}

/** お客様情報・読取① */
export function customerInfoPocketAuth(): AtPocketFetchAuth {
  return { apiKey: apiKeyForCustomerInfoPocket() };
}

/** お客様情報・読取② */
export function customerInfoPocketAuth1(): AtPocketFetchAuth {
  return { apiKey: apiKeyForCustomerInfoPocket1() };
}

/** お客様情報・更新③ */
export function customerInfoPocketAuthWrite(): AtPocketFetchAuth {
  return { apiKey: apiKeyForCustomerInfoWrite() };
}

/** 営業ダッシュボード・契約件数用 fields（未設定時は読取①） */
export function customerInfoDashboardFieldAuth(): AtPocketFetchAuth {
  return {
    apiKey: apiKeyForAppFields("CUSTOMER_INFO", [
      "CUSTOMER_INFO_ATPOCKET_API_KEY_DASHBOARD_FIELDS",
    ]),
  };
}

/** お客様情報・一覧読取（検索・CRM・429 サブキーフェイルオーバー） */
export function customerInfoListAuths(): AtPocketFetchAuth[] {
  return listAuthsForAppList("CUSTOMER_INFO");
}

/** 営業ダッシュボード・契約件数用一覧（サブキーで顧客一覧と分離） */
export function customerInfoDashboardListAuths(): AtPocketFetchAuth[] {
  const extras: string[] = [];
  for (let i = POCKET_LIST_SUB_KEY_MAX; i >= 1; i--) {
    extras.push(`CUSTOMER_INFO_ATPOCKET_API_KEY_DASHBOARD_LIST_${i}`);
  }
  return listAuthsForAppList("CUSTOMER_INFO", extras);
}

export function customerInfoNameFieldId(): string | null {
  const id = process.env.CUSTOMER_INFO_CUSTOMER_NAME_FIELD_ID?.trim();
  return id || null;
}

/** 一覧・検索結果の補足表示（未設定時は工事連携キー列） */
export function customerInfoSubtitleFieldId(): string | null {
  const id =
    process.env.CUSTOMER_INFO_SUBTITLE_FIELD_ID?.trim() ||
    process.env.CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID?.trim();
  return id || null;
}

/** 取込キー（T番号）。PUT 更新時に既存値を載せるために使用 */
export function customerInfoImportKeyFieldId(): string | null {
  return process.env.CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID?.trim() || null;
}

/** GET が field-数字 のみ返すときの T番号読み取り元（カンマ区切り・任意） */
export function customerInfoImportKeySourceFieldIds(): string[] {
  const csv = process.env.CUSTOMER_INFO_IMPORT_KEY_SOURCE_FIELD_IDS?.trim();
  if (!csv) return [];
  return csv.split(",").map((s) => s.trim()).filter(Boolean);
}

/** true のとき CUSTOMER_INFO_EDITABLE_FIELD_IDS のみ（旧方式） */
export function customerInfoUsesLegacyEditableList(): boolean {
  return Boolean(process.env.CUSTOMER_INFO_EDITABLE_FIELD_IDS?.trim());
}

/** 未設定時は組み込みフォーム全項目。旧方式時は CSV のみ */
export function customerInfoEditableFieldIds(): string[] {
  const csv = process.env.CUSTOMER_INFO_EDITABLE_FIELD_IDS?.trim();
  if (csv) {
    return csv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const name = customerInfoNameFieldId();
  return name ? [name] : [];
}

export function customerInfoConfigReady(): {
  ok: true;
  appId: string;
  nameFieldId: string;
} | { ok: false; error: string } {
  const appId = customerInfoAppId();
  if (!appId) {
    return {
      ok: false,
      error: "CUSTOMER_INFO_APP_ID が未設定です",
    };
  }
  const nameFieldId = customerInfoNameFieldId();
  if (!nameFieldId) {
    return {
      ok: false,
      error:
        "CUSTOMER_INFO_CUSTOMER_NAME_FIELD_ID が未設定です（お客様名検索用）",
    };
  }
  return { ok: true, appId, nameFieldId };
}
