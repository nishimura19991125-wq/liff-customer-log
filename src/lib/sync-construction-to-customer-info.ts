import "server-only";

import { atPocketRecordIdFromRow } from "@/lib/atpocket-record-id";
import type { AtPocketFieldRow, AtPocketFetchAuth } from "@/lib/atpocket";
import {
  apiKeyForCustomerInfoPocket,
  createRecord,
  fetchAppFields,
  fetchRecordById,
} from "@/lib/atpocket";
import {
  pickRecordValueByFieldAliases,
  resolveConfiguredFieldToSchemaUniqueId,
  resolveConstructionFieldIds,
} from "@/lib/calendar-kojo";

export type CustomerInfoSyncResult =
  | { kind: "skipped" }
  | { kind: "synced"; customerInfoRecordId?: string }
  | { kind: "failed"; error: string };

function customerInfoAppConfigured(): boolean {
  return Boolean(process.env.CUSTOMER_INFO_APP_ID?.trim());
}

function coercePocketPlainString(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw).trim();
  }
  if (Array.isArray(raw)) {
    return raw.map(coercePocketPlainString).filter(Boolean).join(" ");
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const k of ["value", "displayValue", "label", "name", "text"]) {
      const v = o[k];
      if (v != null && (typeof v === "string" || typeof v === "number")) {
        return String(v).trim();
      }
    }
  }
  return String(raw).trim();
}

/** 工事アプリのレコードからお客様情報連携用ユニークキー（既定は T番号）の uniqueId を決める */
function constructionUniqueKeyFieldConfigured(
  constructionFields: AtPocketFieldRow[],
): string | null {
  const fromEnv =
    process.env.CALENDAR_CONSTRUCTION_UNIQUE_KEY_FIELD_ID?.trim() ||
    process.env.CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID?.trim();
  if (fromEnv) {
    return resolveConfiguredFieldToSchemaUniqueId(fromEnv, constructionFields);
  }
  const fids = resolveConstructionFieldIds(constructionFields);
  const t = fids.tNumber?.trim();
  if (!t) return null;
  return resolveConfiguredFieldToSchemaUniqueId(t, constructionFields);
}

/**
 * 工事アプリへ書き込み済みのレコードを GET し、ユニークキー（T番号等）を取り出して
 * お客様情報アプリに 1 件登録する。
 * CUSTOMER_INFO_APP_ID 未設定時は何もしない（skipped）。
 */
export async function syncConstructionRecordToCustomerInfoApp(opts: {
  calAppId: string;
  constructionRecordId: string;
  customerName: string;
  constructionFields: AtPocketFieldRow[];
  calendarAuth: AtPocketFetchAuth;
}): Promise<CustomerInfoSyncResult> {
  const customerAppId = process.env.CUSTOMER_INFO_APP_ID?.trim();
  if (!customerAppId) {
    return { kind: "skipped" };
  }

  const customerUniqueKeyFieldEnv =
    process.env.CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID?.trim();
  if (!customerUniqueKeyFieldEnv) {
    return {
      kind: "failed",
      error:
        "お客様情報アプリ連携の書き込み先が未設定です。CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID（@pocket の uniqueId）を設定してください。",
    };
  }

  const constructionKeyField = constructionUniqueKeyFieldConfigured(
    opts.constructionFields,
  );
  if (!constructionKeyField) {
    return {
      kind: "failed",
      error:
        "工事アプリからユニークキー（T番号）のフィールドを特定できません。CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID または CALENDAR_CONSTRUCTION_UNIQUE_KEY_FIELD_ID を設定してください。",
    };
  }

  const customerAuth: AtPocketFetchAuth = {
    apiKey: apiKeyForCustomerInfoPocket(),
  };

  const customerFields = await fetchAppFields(customerAppId, customerAuth);
  const resolvedCustomerKey = resolveConfiguredFieldToSchemaUniqueId(
    customerUniqueKeyFieldEnv,
    customerFields,
  );
  if (!resolvedCustomerKey) {
    return {
      kind: "failed",
      error: `お客様情報アプリの連携先フィールド「${customerUniqueKeyFieldEnv}」がフィールド定義と一致しません。`,
    };
  }

  const customerNameFieldEnv =
    process.env.CUSTOMER_INFO_CUSTOMER_NAME_FIELD_ID?.trim();
  let resolvedCustomerName: string | null = null;
  if (customerNameFieldEnv) {
    resolvedCustomerName = resolveConfiguredFieldToSchemaUniqueId(
      customerNameFieldEnv,
      customerFields,
    );
    if (!resolvedCustomerName) {
      return {
        kind: "failed",
        error: `お客様情報アプリのお客様名フィールド「${customerNameFieldEnv}」がフィールド定義と一致しません。`,
      };
    }
  }

  const fieldsCsv = [constructionKeyField, resolvedCustomerKey]
    .concat(resolvedCustomerName ? [resolvedCustomerName] : [])
    .join(",");

  let recRow = await fetchRecordById(
    opts.calAppId,
    opts.constructionRecordId,
    opts.calendarAuth,
    fieldsCsv,
  );
  if (!recRow?.record) {
    recRow = await fetchRecordById(
      opts.calAppId,
      opts.constructionRecordId,
      opts.calendarAuth,
    );
  }

  if (!recRow?.record || typeof recRow.record !== "object") {
    return { kind: "failed", error: "工事アプリのレコードを再取得できませんでした。" };
  }

  const recObj = recRow.record as Record<string, unknown>;
  const uniqueKey = coercePocketPlainString(
    pickRecordValueByFieldAliases(recObj, constructionKeyField),
  );
  if (!uniqueKey) {
    return {
      kind: "failed",
      error:
        "工事レコードからユニークキー（T番号）を取得できませんでした。@pocket で採番・反映されているか確認してください。",
    };
  }

  const customerRecord: Record<string, unknown> = {
    [resolvedCustomerKey]: uniqueKey,
  };
  if (resolvedCustomerName) {
    customerRecord[resolvedCustomerName] = opts.customerName.trim();
  }

  const created = await createRecord(
    customerAppId,
    customerRecord,
    customerAuth,
  );
  const customerInfoRecordId = atPocketRecordIdFromRow(created) ?? undefined;

  return { kind: "synced", customerInfoRecordId };
}
