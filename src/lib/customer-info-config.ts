import "server-only";

import type { AtPocketFetchAuth } from "@/lib/atpocket";
import { apiKeyForCustomerInfoPocket } from "@/lib/atpocket";

export function customerInfoAppId(): string | null {
  const id = process.env.CUSTOMER_INFO_APP_ID?.trim();
  return id || null;
}

export function customerInfoPocketAuth(): AtPocketFetchAuth {
  return { apiKey: apiKeyForCustomerInfoPocket() };
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

/** 未設定時はお客様名のみ編集可（後から CUSTOMER_INFO_EDITABLE_FIELD_IDS で追加） */
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
