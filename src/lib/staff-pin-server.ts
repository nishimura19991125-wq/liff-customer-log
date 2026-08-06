import "server-only";

import { timingSafeEqual } from "node:crypto";

import {
  apiKeyForStaffPocketRead,
  apiKeyForStaffPocketRead1,
  apiKeyForStaffWrite,
  fetchAppFieldUniqueIdsSetTryKeys,
  fetchAppFields,
  fetchRecordById,
  pickRecordFieldsForSchema,
  stripLikelyInvalidPocketKeysFromRecord,
  updateRecord,
} from "@/lib/atpocket";
import {
  boundStaffFromRosterRows,
  fetchStaffRosterRowsCached,
  invalidateStaffRosterCache,
} from "@/lib/staff-roster-cache";
import {
  generateStaffResetCode,
  isResetApprovalApproved,
  isStaffPinConfigured,
  isStaffPinUnset,
  isValidFourDigitPin,
  readStaffPinFieldValue,
  resolveStaffPinFieldIds,
  staffPinFieldsConfigured,
  staffPinLockFeatureEnabled,
  STAFF_PIN_RESET_APPROVED,
  STAFF_PIN_RESET_PENDING,
  type StaffPinFieldIds,
} from "@/lib/staff-pin-fields";
import {
  enrichCleanedRecordWithImportKey,
  pocketHyphenNumericFieldKeysToPreserveForStaffBind,
  staffImportKeyFieldIdResolved,
  staffRecordRefreshFieldsCsv,
} from "@/lib/staff-import-key";
import {
  staffLineUserIdFieldIdsFromEnv,
} from "@/lib/staff-line-field-config";
export type StaffPinPublicState = {
  enabled: boolean;
  configured: boolean;
  resetApproval: string;
  hasResetCode: boolean;
  /** 初回設定が必要（PIN未登録） */
  needsInitialSetup: boolean;
};

export type BoundStaffContext =
  | { ok: true; staffId: string; staffName: string; fieldIds: StaffPinFieldIds }
  | { ok: false; status: number; error: string };

function pinMatches(stored: string, entered: string): boolean {
  const a = Buffer.from(stored);
  const b = Buffer.from(entered);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function resolveBoundStaffPinContext(
  lineUserId: string,
): Promise<BoundStaffContext> {
  if (!staffPinLockFeatureEnabled()) {
    return { ok: false, status: 503, error: "PINロックは無効です" };
  }

  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const staffNameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim();
  if (!staffAppId || !staffNameFieldId) {
    return {
      ok: false,
      status: 500,
      error: "STAFF_APP_ID または STAFF_NAME_FIELD_ID が未設定です",
    };
  }

  const rows = await fetchStaffRosterRowsCached();
  const bound = boundStaffFromRosterRows(rows, lineUserId);
  if (!bound) {
    return { ok: false, status: 403, error: "担当者の紐付けが必要です" };
  }

  const readAuth = { apiKey: apiKeyForStaffPocketRead() };
  const appFields = await fetchAppFields(staffAppId, readAuth);
  const fieldIds = resolveStaffPinFieldIds(appFields);
  if (!staffPinFieldsConfigured(fieldIds)) {
    return {
      ok: false,
      status: 503,
      error:
        "スタッフ名簿に PINコード・リセット認証コード・リセット承認フラグ の列が見つかりません",
    };
  }

  return {
    ok: true,
    staffId: bound.id,
    staffName: bound.name,
    fieldIds,
  };
}

function staffPinFieldsCsv(fieldIds: StaffPinFieldIds): string {
  return [
    fieldIds.pinCodeFieldId,
    fieldIds.resetCodeFieldId,
    fieldIds.resetApprovalFieldId,
  ]
    .filter(Boolean)
    .join(",");
}

async function fetchStaffRecordForPinUpdate(
  staffAppId: string,
  staffId: string,
  fieldIds: StaffPinFieldIds,
): Promise<Record<string, unknown>> {
  const lineIds = staffLineUserIdFieldIdsFromEnv();
  const staffNameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim() ?? "";
  const readAuth = { apiKey: apiKeyForStaffPocketRead() };
  const refreshCsv = [
    staffRecordRefreshFieldsCsv({
      staffNameFieldId,
      lineField1: lineIds.lineField1,
      lineField2: lineIds.lineField2,
    }),
    staffPinFieldsCsv(fieldIds),
  ]
    .filter(Boolean)
    .join(",");

  const row = await fetchRecordById(
    staffAppId,
    staffId,
    readAuth,
    refreshCsv,
  );
  if (!row?.record || typeof row.record !== "object") {
    throw new Error("スタッフレコードが見つかりません");
  }
  return row.record as Record<string, unknown>;
}

async function putStaffPinPartialUpdate(
  staffAppId: string,
  staffId: string,
  fieldIds: StaffPinFieldIds,
  patch: Record<string, unknown>,
): Promise<void> {
  const recordObj = await fetchStaffRecordForPinUpdate(
    staffAppId,
    staffId,
    fieldIds,
  );

  const lineIds = staffLineUserIdFieldIdsFromEnv();
  const staffNameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim() ?? "";
  const writeAuth = { apiKey: apiKeyForStaffWrite() };
  const schemaUniqueIds = await fetchAppFieldUniqueIdsSetTryKeys(staffAppId, [
    apiKeyForStaffPocketRead(),
    apiKeyForStaffPocketRead1(),
    apiKeyForStaffWrite(),
  ]);

  const preserveHyphen = pocketHyphenNumericFieldKeysToPreserveForStaffBind({
    staffNameFieldId,
    lineField1: lineIds.lineField1,
    lineField2: lineIds.lineField2,
  });
  for (const id of [
    fieldIds.pinCodeFieldId,
    fieldIds.resetCodeFieldId,
    fieldIds.resetApprovalFieldId,
  ]) {
    if (id) preserveHyphen.add(id);
  }

  const merged = { ...recordObj, ...patch };
  const cleanedRecord = enrichCleanedRecordWithImportKey(
    recordObj,
    stripLikelyInvalidPocketKeysFromRecord(merged, preserveHyphen),
  );

  const picked =
    schemaUniqueIds != null && schemaUniqueIds.size > 0
      ? pickRecordFieldsForSchema(cleanedRecord, schemaUniqueIds)
      : cleanedRecord;

  const payload: Record<string, unknown> = { ...picked };
  for (const [k, v] of Object.entries(patch)) {
    payload[k] = v;
  }
  for (const k of Object.keys(cleanedRecord)) {
    if (!(k in payload) && cleanedRecord[k] !== undefined) {
      payload[k] = cleanedRecord[k];
    }
  }

  const importKeyId = staffImportKeyFieldIdResolved();
  if (importKeyId && payload[importKeyId] === undefined && cleanedRecord[importKeyId] !== undefined) {
    payload[importKeyId] = cleanedRecord[importKeyId];
  }

  await updateRecord(staffAppId, staffId, payload, writeAuth);
  invalidateStaffRosterCache();
}

export async function readStaffPinPublicState(
  ctx: Extract<BoundStaffContext, { ok: true }>,
): Promise<StaffPinPublicState> {
  const staffAppId = process.env.STAFF_APP_ID!.trim();
  const recObj = await fetchStaffRecordForPinUpdate(
    staffAppId,
    ctx.staffId,
    ctx.fieldIds,
  );
  const pin = readStaffPinFieldValue(recObj, ctx.fieldIds.pinCodeFieldId);
  const resetCode = readStaffPinFieldValue(
    recObj,
    ctx.fieldIds.resetCodeFieldId,
  );
  const resetApproval = readStaffPinFieldValue(
    recObj,
    ctx.fieldIds.resetApprovalFieldId,
  );

  const needsInitialSetup = isStaffPinUnset(pin);

  return {
    enabled: true,
    configured: isStaffPinConfigured(pin),
    resetApproval: resetApproval || STAFF_PIN_RESET_PENDING,
    hasResetCode: Boolean(resetCode && isValidFourDigitPin(resetCode)),
    needsInitialSetup,
  };
}

export async function verifyStaffPin(
  ctx: Extract<BoundStaffContext, { ok: true }>,
  enteredPin: string,
): Promise<
  | { ok: true }
  | { ok: false; error: string; needsInitialSetup?: boolean }
> {
  if (!isValidFourDigitPin(enteredPin)) {
    return { ok: false, error: "4桁の数字を入力してください" };
  }

  const staffAppId = process.env.STAFF_APP_ID!.trim();
  const recObj = await fetchStaffRecordForPinUpdate(
    staffAppId,
    ctx.staffId,
    ctx.fieldIds,
  );
  const stored = readStaffPinFieldValue(recObj, ctx.fieldIds.pinCodeFieldId);
  if (isStaffPinUnset(stored)) {
    return {
      ok: false,
      needsInitialSetup: true,
      error: "暗証番号が未登録です。新しい4桁を設定してください",
    };
  }
  if (!pinMatches(stored, enteredPin)) {
    return { ok: false, error: "暗証番号が正しくありません" };
  }
  return { ok: true };
}

export async function requestStaffPinReset(
  ctx: Extract<BoundStaffContext, { ok: true }>,
): Promise<{ resetCode: string }> {
  const resetCode = generateStaffResetCode();
  const staffAppId = process.env.STAFF_APP_ID!.trim();
  const patch: Record<string, unknown> = {
    [ctx.fieldIds.resetCodeFieldId!]: resetCode,
    [ctx.fieldIds.resetApprovalFieldId!]: STAFF_PIN_RESET_PENDING,
  };
  await putStaffPinPartialUpdate(staffAppId, ctx.staffId, ctx.fieldIds, patch);
  return { resetCode };
}

export async function setStaffPinAfterApproval(
  ctx: Extract<BoundStaffContext, { ok: true }>,
  newPin: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isValidFourDigitPin(newPin)) {
    return { ok: false, error: "4桁の数字を入力してください" };
  }

  const staffAppId = process.env.STAFF_APP_ID!.trim();
  const recObj = await fetchStaffRecordForPinUpdate(
    staffAppId,
    ctx.staffId,
    ctx.fieldIds,
  );
  const approval = readStaffPinFieldValue(
    recObj,
    ctx.fieldIds.resetApprovalFieldId,
  );
  if (!isResetApprovalApproved(approval)) {
    return { ok: false, error: "事務所の承認を待っています" };
  }

  const patch: Record<string, unknown> = {
    [ctx.fieldIds.pinCodeFieldId!]: newPin,
    [ctx.fieldIds.resetCodeFieldId!]: "",
    [ctx.fieldIds.resetApprovalFieldId!]: STAFF_PIN_RESET_PENDING,
  };
  await putStaffPinPartialUpdate(staffAppId, ctx.staffId, ctx.fieldIds, patch);
  return { ok: true };
}

export async function setStaffInitialPin(
  ctx: Extract<BoundStaffContext, { ok: true }>,
  newPin: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isValidFourDigitPin(newPin)) {
    return { ok: false, error: "4桁の数字を入力してください" };
  }

  const staffAppId = process.env.STAFF_APP_ID!.trim();

  // 多層防御: 呼び出し側でも分岐しているが、ここでも既存 PIN の有無を確認する。
  // これが無いと「初期設定」を名乗るだけで承認フローを迂回して上書きできる。
  const current = await fetchStaffRecordForPinUpdate(
    staffAppId,
    ctx.staffId,
    ctx.fieldIds,
  );
  const storedPin = readStaffPinFieldValue(current, ctx.fieldIds.pinCodeFieldId);
  if (!isStaffPinUnset(storedPin)) {
    return {
      ok: false,
      error: "暗証番号はすでに登録されています。事務所の承認を受けてください",
    };
  }
  const patch: Record<string, unknown> = {
    [ctx.fieldIds.pinCodeFieldId!]: newPin,
    [ctx.fieldIds.resetCodeFieldId!]: "",
    [ctx.fieldIds.resetApprovalFieldId!]: STAFF_PIN_RESET_PENDING,
  };
  await putStaffPinPartialUpdate(staffAppId, ctx.staffId, ctx.fieldIds, patch);
  return { ok: true };
}
