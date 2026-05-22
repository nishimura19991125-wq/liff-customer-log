import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { readCustomerInfoFieldValue } from "@/lib/customer-info-record";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

function pickFieldUniqueIdByExactCaption(
  fields: AtPocketFieldRow[],
  caption: string,
): string | null {
  const target = nfkc(caption).toLowerCase();
  for (const f of fields) {
    const cap = f.caption ? nfkc(String(f.caption)).toLowerCase() : "";
    if (cap && cap === target) {
      const id = f.uniqueId?.trim();
      return id || null;
    }
  }
  return null;
}

/** 案件作成者列（@pocket の見出しまたは環境変数） */
export function resolveCustomerInfoCreatorFieldId(
  appFields: AtPocketFieldRow[],
): string | null {
  const env = process.env.CUSTOMER_INFO_CREATOR_FIELD_ID?.trim();
  if (env) {
    return resolveConfiguredFieldToSchemaUniqueId(env, appFields);
  }
  for (const cap of [
    "案件作成者",
    "作成者",
    "登録者",
    "作成担当者",
    "登録担当者",
  ]) {
    const id = pickFieldUniqueIdByExactCaption(appFields, cap);
    if (id) return id;
  }
  return null;
}

export function staffAssigneeNamePresent(raw: string): boolean {
  const n = normApClStaffName(raw);
  return Boolean(n && n !== "-" && n !== "－");
}

export function readStaffAssigneeName(
  recObj: Record<string, unknown>,
  fieldId: string | null,
): string {
  if (!fieldId) return "";
  return normApClStaffName(readCustomerInfoFieldValue(recObj, fieldId));
}

export function apClAssigneesBothUnset(
  recObj: Record<string, unknown>,
  apFieldId: string | null,
  clFieldId: string | null,
): boolean {
  const ap = readStaffAssigneeName(recObj, apFieldId);
  const cl = readStaffAssigneeName(recObj, clFieldId);
  return !staffAssigneeNamePresent(ap) && !staffAssigneeNamePresent(cl);
}

export type CustomerInfoPendingAudienceReason = "ap" | "cl" | "creator";

/**
 * 未入力一覧の表示対象: AP/CL 担当者一致、または担当者未設定で作成者一致。
 */
export function matchCustomerInfoPendingAudience(
  recObj: Record<string, unknown>,
  boundStaffName: string,
  apFieldId: string | null,
  clFieldId: string | null,
  creatorFieldId: string | null,
): CustomerInfoPendingAudienceReason | null {
  const bound = normApClStaffName(boundStaffName);
  if (!bound) return null;

  const ap = readStaffAssigneeName(recObj, apFieldId);
  const cl = readStaffAssigneeName(recObj, clFieldId);

  if (staffAssigneeNamePresent(ap) && ap === bound) return "ap";
  if (staffAssigneeNamePresent(cl) && cl === bound) return "cl";

  if (
    apClAssigneesBothUnset(recObj, apFieldId, clFieldId) &&
    creatorFieldId
  ) {
    const creator = readStaffAssigneeName(recObj, creatorFieldId);
    if (staffAssigneeNamePresent(creator) && creator === bound) {
      return "creator";
    }
  }

  return null;
}

export function applyCreatorNameToCustomerRecord(
  customerRecord: Record<string, unknown>,
  customerFields: AtPocketFieldRow[],
  staffName: string,
): void {
  const name = normApClStaffName(staffName);
  if (!name) return;

  const creatorFieldId = resolveCustomerInfoCreatorFieldId(customerFields);
  if (!creatorFieldId) return;

  customerRecord[creatorFieldId] = name;
}

/** 工事連携などで案件作成者を LINE 紐付け担当者名で記録 */
export async function applyCreatorFromLineUserToCustomerRecord(
  customerRecord: Record<string, unknown>,
  customerFields: AtPocketFieldRow[],
  lineUserId: string,
): Promise<void> {
  const want = lineUserId.trim();
  if (!want) return;

  const name = await resolveBoundStaffNameForLineUser(want);
  if (name) {
    applyCreatorNameToCustomerRecord(customerRecord, customerFields, name);
  }
}
