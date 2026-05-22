import "server-only";

import { atPocketRecordIdFromRow } from "@/lib/atpocket-record-id";
import type { AtPocketFieldRow, AtPocketFetchAuth } from "@/lib/atpocket";
import {
  apiKeyForCustomerInfoPocket,
  createRecord,
  fetchAppFields,
  fetchRecordById,
  updateRecord,
} from "@/lib/atpocket";
import { findCustomerInfoRecordIdByUniqueKey } from "@/lib/customer-info-key-lookup";
import { customerInfoPutValue } from "@/lib/customer-info-record";
import {
  pickRecordValueByFieldAliases,
  resolveConfiguredFieldToSchemaUniqueId,
  resolveConstructionFieldIds,
} from "@/lib/calendar-kojo";
import {
  resolveConstructionRegistrationNumberFieldIds,
  resolveCustomerInfoRegistrationNumberFieldIds,
} from "@/lib/construction-customer-info-sync-fields";
import { resolveCustomerInfoFormFieldId } from "@/lib/customer-info-form/resolve-fields";
import { defaultApClStaffNamesForLineUser } from "@/lib/staff-ap-cl-candidates";
import {
  lookupStaffWorkplaceByStaffName,
  resolveStaffWorkplaceLookupConfig,
} from "@/lib/staff-workplace-lookup";

export type CustomerInfoSyncResult =
  | { kind: "skipped" }
  | { kind: "synced"; customerInfoRecordId?: string }
  | { kind: "failed"; error: string };

function customerInfoAppConfigured(): boolean {
  return Boolean(process.env.CUSTOMER_INFO_APP_ID?.trim());
}

function pocketSyncErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (raw.includes("403")) {
    return (
      "お客様情報アプリのフィールド一覧を取得できません（403 Forbidden）。" +
      "CUSTOMER_INFO_ATPOCKET_API_KEY が CUSTOMER_INFO_APP_ID のお客様情報アプリに対して「参照」権限を持っているか確認してください。"
    );
  }
  if (raw.includes("401")) {
    return (
      "お客様情報アプリへの認証に失敗しました（401）。" +
      "CUSTOMER_INFO_ATPOCKET_API_KEY を確認してください。"
    );
  }
  if (raw.includes("list fields failed")) {
    return `お客様情報アプリのフィールド定義を取得できません。${raw}`;
  }
  if (raw.includes("create record failed")) {
    return `お客様情報アプリへのレコード登録に失敗しました。${raw}`;
  }
  if (raw.includes("update record failed")) {
    return `お客様情報アプリへのレコード更新に失敗しました。${raw}`;
  }
  if (raw.includes("キー項目が重複")) {
    return (
      "お客様情報アプリに同じキー項目（T番号）のレコードが既にありますが、照合で見つけられませんでした。" +
      "CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID が T番号列の uniqueId と一致しているか確認してください。"
    );
  }
  return raw || "お客様情報アプリへの連携に失敗しました。";
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
 * お客様情報アプリに登録する。同一キーが既にあれば更新（PUT）、なければ新規（POST）。
 * CUSTOMER_INFO_APP_ID 未設定時は何もしない（skipped）。
 */
export async function syncConstructionRecordToCustomerInfoApp(opts: {
  calAppId: string;
  constructionRecordId: string;
  customerName: string;
  constructionFields: AtPocketFieldRow[];
  calendarAuth: AtPocketFetchAuth;
  /** LIFF ログイン者の LINE ID（sub）。AP/CL担当者の自動転記に使用 */
  lineUserId?: string;
}): Promise<CustomerInfoSyncResult> {
  try {
    return await syncConstructionRecordToCustomerInfoAppInner(opts);
  } catch (e) {
    console.error("[sync-construction-to-customer-info]", e);
    return { kind: "failed", error: pocketSyncErrorMessage(e) };
  }
}

const BRANCH_FALLBACK = "-";

async function applyApClStaffFromLineUserToCustomerRecord(
  customerRecord: Record<string, unknown>,
  customerFields: AtPocketFieldRow[],
  lineUserId: string,
): Promise<void> {
  const want = lineUserId.trim();
  if (!want) return;

  const { apStaff, clStaff } = await defaultApClStaffNamesForLineUser(want);
  const apStaffFieldId = resolveCustomerInfoFormFieldId(
    "apStaff",
    "AP担当者",
    customerFields,
  );
  const clStaffFieldId = resolveCustomerInfoFormFieldId(
    "clStaff",
    "CL担当者",
    customerFields,
  );
  if (apStaff && apStaffFieldId) {
    customerRecord[apStaffFieldId] = apStaff;
  }
  if (clStaff && clStaffFieldId) {
    customerRecord[clStaffFieldId] = clStaff;
  }

  const staffCfg = await resolveStaffWorkplaceLookupConfig();
  if (!staffCfg) return;

  const apBranchFieldId = resolveCustomerInfoFormFieldId(
    "apBranch",
    "AP所属支店",
    customerFields,
  );
  const clBranchFieldId = resolveCustomerInfoFormFieldId(
    "clBranch",
    "CL所属支店",
    customerFields,
  );
  if (apStaff && apBranchFieldId) {
    const workplace = await lookupStaffWorkplaceByStaffName(apStaff, staffCfg);
    customerRecord[apBranchFieldId] = workplace?.trim() || BRANCH_FALLBACK;
  }
  if (clStaff && clBranchFieldId) {
    const workplace = await lookupStaffWorkplaceByStaffName(clStaff, staffCfg);
    customerRecord[clBranchFieldId] = workplace?.trim() || BRANCH_FALLBACK;
  }
}

async function syncConstructionRecordToCustomerInfoAppInner(opts: {
  calAppId: string;
  constructionRecordId: string;
  customerName: string;
  constructionFields: AtPocketFieldRow[];
  calendarAuth: AtPocketFetchAuth;
  lineUserId?: string;
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

  const constructionRegFields =
    resolveConstructionRegistrationNumberFieldIds(opts.constructionFields);
  const customerRegFields =
    resolveCustomerInfoRegistrationNumberFieldIds(customerFields);

  const registrationPairs: Array<{
    constructionFieldId: string;
    customerFieldId: string;
    label: string;
  }> = [];
  if (
    constructionRegFields.apptRegistrationNumber &&
    customerRegFields.apptRegistrationNumber
  ) {
    registrationPairs.push({
      constructionFieldId: constructionRegFields.apptRegistrationNumber,
      customerFieldId: customerRegFields.apptRegistrationNumber,
      label: "APPT登録番号",
    });
  }
  if (
    constructionRegFields.clptRegistrationNumber &&
    customerRegFields.clptRegistrationNumber
  ) {
    registrationPairs.push({
      constructionFieldId: constructionRegFields.clptRegistrationNumber,
      customerFieldId: customerRegFields.clptRegistrationNumber,
      label: "CLPT登録番号",
    });
  }

  const fieldsCsv = [
    constructionKeyField,
    resolvedCustomerKey,
    ...registrationPairs.map((p) => p.constructionFieldId),
    ...(resolvedCustomerName ? [resolvedCustomerName] : []),
  ]
    .filter((id, i, arr) => id && arr.indexOf(id) === i)
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

  for (const pair of registrationPairs) {
    const regValue = coercePocketPlainString(
      pickRecordValueByFieldAliases(recObj, pair.constructionFieldId),
    );
    if (regValue) {
      customerRecord[pair.customerFieldId] = regValue;
    }
  }

  if (opts.lineUserId?.trim()) {
    await applyApClStaffFromLineUserToCustomerRecord(
      customerRecord,
      customerFields,
      opts.lineUserId.trim(),
    );
  }

  const pocketPayload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(customerRecord)) {
    pocketPayload[k] = customerInfoPutValue(v);
  }

  const existingId = await findCustomerInfoRecordIdByUniqueKey(
    resolvedCustomerKey,
    uniqueKey,
  );

  if (existingId) {
    await updateRecord(
      customerAppId,
      existingId,
      pocketPayload,
      customerAuth,
    );
    return { kind: "synced", customerInfoRecordId: existingId };
  }

  const created = await createRecord(
    customerAppId,
    pocketPayload,
    customerAuth,
  );
  const customerInfoRecordId = atPocketRecordIdFromRow(created) ?? undefined;

  return { kind: "synced", customerInfoRecordId };
}
