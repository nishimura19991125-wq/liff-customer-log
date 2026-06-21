import "server-only";

import {
  atPocketRecordIdFromCreateResult,
  pollConstructionTNumberByRecordId,
  SYNC_TNUMBER_POLL_DELAYS_MS,
} from "@/lib/atpocket-record-id";
import type { AtPocketFieldRow, AtPocketFetchAuth } from "@/lib/atpocket";
import {
  apiKeyForCustomerInfoWrite,
  createRecord,
  fetchAppFields,
  fetchRecordById,
  updateRecord,
} from "@/lib/atpocket";
import { customerInfoPutValue } from "@/lib/customer-info-record";
import {
  pickRecordValueByFieldAliases,
  resolveConfiguredFieldToSchemaUniqueId,
  resolveConstructionFieldIds,
  resolveConstructionTNumberFieldId,
} from "@/lib/calendar-kojo";
import {
  resolveConstructionRegistrationNumberFieldIds,
  resolveCustomerInfoRegistrationNumberFieldIds,
} from "@/lib/construction-customer-info-sync-fields";
import { INPUT_STATUS_PENDING } from "@/lib/customer-info-form/options";
import {
  applyCreatorNameToCustomerRecord,
} from "@/lib/customer-info-creator-field";
import { findCustomerInfoRecordIdByUniqueKeyCached } from "@/lib/customer-info-key-lookup-cache";
import { defaultApClStaffNamesForLineUser } from "@/lib/staff-ap-cl-candidates";
import {
  boundStaffFromRosterRows,
  fetchStaffRosterRowsCached,
} from "@/lib/staff-roster-cache";
import { dateValueForPocket } from "@/lib/customer-info-form/date-pocket";
import {
  normalizeDateForInput,
  resolveCustomerInfoFormFieldId,
} from "@/lib/customer-info-form/resolve-fields";
import { readCustomerInfoFieldValue } from "@/lib/customer-info-record";
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
      "CUSTOMER_INFO_ATPOCKET_API_KEY_2 が CUSTOMER_INFO_APP_ID のお客様情報アプリに対して「登録・更新」権限を持っているか確認してください。"
    );
  }
  if (raw.includes("401")) {
    return (
      "お客様情報アプリへの認証に失敗しました（401）。" +
      "CUSTOMER_INFO_ATPOCKET_API_KEY_2（お客様情報アプリの登録権限のあるキー）を確認してください。"
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

/**
 * 工事アプリへ書き込み済みのレコードを GET し、ユニークキー（T番号等）を取り出して
 * お客様情報アプリに登録する。同一キーが既にあれば更新（PUT）、なければ新規（POST）。
 * CUSTOMER_INFO_APP_ID 未設定時は何もしない（skipped）。
 */
export async function syncConstructionRecordToCustomerInfoApp(opts: {
  calAppId: string;
  /** 工事レコード ID（空枠更新時は必須。新規で取れないときは constructionUniqueKey と併用） */
  constructionRecordId?: string;
  /** 工事 T番号（recordId 未取得時に空枠登録と同様の連携を行う） */
  constructionUniqueKey?: string;
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
  precomputed?: { apStaff: string | null; clStaff: string | null },
): Promise<void> {
  const want = lineUserId.trim();
  if (!want) return;

  const { apStaff, clStaff } =
    precomputed ?? (await defaultApClStaffNamesForLineUser(want));
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
  constructionRecordId?: string;
  constructionUniqueKey?: string;
  customerName: string;
  constructionFields: AtPocketFieldRow[];
  calendarAuth: AtPocketFetchAuth;
  lineUserId?: string;
}): Promise<CustomerInfoSyncResult> {
  const customerAppId = process.env.CUSTOMER_INFO_APP_ID?.trim();
  if (!customerAppId) {
    return { kind: "skipped" };
  }

  const constructionRecordId = opts.constructionRecordId?.trim() || "";
  const keyFromOpts = opts.constructionUniqueKey?.trim() || "";
  if (!constructionRecordId && !keyFromOpts) {
    return {
      kind: "failed",
      error:
        "工事レコードを特定できませんでした。お客様情報アプリへの連携に必要な T番号またはレコード ID が取得できません。",
    };
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

  const constructionKeyField = resolveConstructionTNumberFieldId(
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
    apiKey: apiKeyForCustomerInfoWrite(),
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

  const constructionFids = resolveConstructionFieldIds(opts.constructionFields);
  const customerContractorFieldId = resolveCustomerInfoFormFieldId(
    "constructionContractor",
    "施工業者",
    customerFields,
  );
  const customerConstructionDateFieldId = resolveCustomerInfoFormFieldId(
    "constructionDate",
    "施工予定日",
    customerFields,
  );
  const customerFirstConstructionDateFieldId = resolveCustomerInfoFormFieldId(
    "firstConstructionDate",
    "初回施工予定日",
    customerFields,
  );

  const fieldsCsv = [
    constructionKeyField,
    ...(constructionFids.contractor ? [constructionFids.contractor] : []),
    ...(constructionFids.startDate ? [constructionFids.startDate] : []),
    resolvedCustomerKey,
    ...registrationPairs.map((p) => p.constructionFieldId),
    ...(resolvedCustomerName ? [resolvedCustomerName] : []),
  ]
    .filter((id, i, arr) => id && arr.indexOf(id) === i)
    .join(",");

  let recObj: Record<string, unknown> | null = null;
  let uniqueKey = keyFromOpts;

  if (constructionRecordId) {
    let recRow = await fetchRecordById(
      opts.calAppId,
      constructionRecordId,
      opts.calendarAuth,
      fieldsCsv,
    );
    if (!recRow?.record) {
      recRow = await fetchRecordById(
        opts.calAppId,
        constructionRecordId,
        opts.calendarAuth,
      );
    }

    if (!recRow?.record || typeof recRow.record !== "object") {
      return {
        kind: "failed",
        error: "工事アプリのレコードを再取得できませんでした。",
      };
    }

    recObj = recRow.record as Record<string, unknown>;
    if (!uniqueKey) {
      uniqueKey = coercePocketPlainString(
        pickRecordValueByFieldAliases(recObj, constructionKeyField),
      );
    }
  }

  if (!uniqueKey && constructionRecordId) {
    const polledKey = await pollConstructionTNumberByRecordId(
      opts.calAppId,
      constructionRecordId,
      constructionKeyField,
      opts.calendarAuth,
      fieldsCsv,
      SYNC_TNUMBER_POLL_DELAYS_MS,
    );
    if (polledKey) uniqueKey = polledKey;
    if (uniqueKey && !recObj) {
      let recRow = await fetchRecordById(
        opts.calAppId,
        constructionRecordId,
        opts.calendarAuth,
        fieldsCsv,
      );
      if (!recRow?.record) {
        recRow = await fetchRecordById(
          opts.calAppId,
          constructionRecordId,
          opts.calendarAuth,
        );
      }
      if (recRow?.record && typeof recRow.record === "object") {
        recObj = recRow.record as Record<string, unknown>;
      }
    }
  }

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

  if (recObj) {
    for (const pair of registrationPairs) {
      const regValue = coercePocketPlainString(
        pickRecordValueByFieldAliases(recObj, pair.constructionFieldId),
      );
      if (regValue) {
        customerRecord[pair.customerFieldId] = regValue;
      }
    }

    if (constructionFids.contractor && customerContractorFieldId) {
      const contractorValue = coercePocketPlainString(
        pickRecordValueByFieldAliases(recObj, constructionFids.contractor),
      );
      if (contractorValue) {
        customerRecord[customerContractorFieldId] = contractorValue;
      }
    }

    if (
      constructionFids.startDate &&
      (customerConstructionDateFieldId || customerFirstConstructionDateFieldId)
    ) {
      const dateRaw = coercePocketPlainString(
        pickRecordValueByFieldAliases(recObj, constructionFids.startDate),
      );
      const normalized = normalizeDateForInput(dateRaw);
      const pocketDate = dateValueForPocket(normalized || dateRaw);
      if (pocketDate) {
        if (customerConstructionDateFieldId) {
          customerRecord[customerConstructionDateFieldId] = pocketDate;
        }
        if (customerFirstConstructionDateFieldId) {
          customerRecord[customerFirstConstructionDateFieldId] = pocketDate;
        }
      }
    }
  }

  if (opts.lineUserId?.trim()) {
    const lineUserId = opts.lineUserId.trim();
    const [{ apStaff, clStaff }, rosterRows] = await Promise.all([
      defaultApClStaffNamesForLineUser(lineUserId),
      fetchStaffRosterRowsCached(),
    ]);
    await applyApClStaffFromLineUserToCustomerRecord(
      customerRecord,
      customerFields,
      lineUserId,
      { apStaff, clStaff },
    );
    const bound = boundStaffFromRosterRows(rosterRows, lineUserId);
    const creatorName = bound?.name ?? apStaff ?? clStaff ?? null;
    if (creatorName) {
      applyCreatorNameToCustomerRecord(
        customerRecord,
        customerFields,
        creatorName,
      );
    }
  }

  const inputStatusFieldId = resolveCustomerInfoFormFieldId(
    "inputStatus",
    "入力ステータス",
    customerFields,
  );
  if (inputStatusFieldId) {
    customerRecord[inputStatusFieldId] = INPUT_STATUS_PENDING;
  }

  const pocketPayload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(customerRecord)) {
    pocketPayload[k] = customerInfoPutValue(v);
  }

  const existingId = await findCustomerInfoRecordIdByUniqueKeyCached(
    resolvedCustomerKey,
    uniqueKey,
  );

  if (existingId) {
    if (inputStatusFieldId) {
      let existingRow = await fetchRecordById(
        customerAppId,
        existingId,
        customerAuth,
        inputStatusFieldId,
      );
      if (!existingRow?.record) {
        existingRow = await fetchRecordById(
          customerAppId,
          existingId,
          customerAuth,
        );
      }
      const existingRec = existingRow?.record;
      if (existingRec && typeof existingRec === "object") {
        const currentStatus = readCustomerInfoFieldValue(
          existingRec as Record<string, unknown>,
          inputStatusFieldId,
        );
        if (currentStatus.trim()) {
          delete pocketPayload[inputStatusFieldId];
        }
      }
    }
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
  const customerInfoRecordId =
    atPocketRecordIdFromCreateResult(created) ?? undefined;

  return { kind: "synced", customerInfoRecordId };
}
