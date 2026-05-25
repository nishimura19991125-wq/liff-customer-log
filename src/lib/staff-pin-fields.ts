import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";

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

export const STAFF_PIN_RESET_PENDING = "未承認";
export const STAFF_PIN_RESET_APPROVED = "承認済";

export type StaffPinFieldIds = {
  pinCodeFieldId: string | null;
  resetCodeFieldId: string | null;
  resetApprovalFieldId: string | null;
};

export function staffPinLockFeatureEnabled(): boolean {
  const raw = process.env.STAFF_PIN_LOCK_DISABLED?.trim().toLowerCase();
  return raw !== "true" && raw !== "1";
}

export function resolveStaffPinFieldIds(
  appFields: AtPocketFieldRow[],
): StaffPinFieldIds {
  const pinEnv = process.env.STAFF_PIN_CODE_FIELD_ID?.trim();
  const resetCodeEnv = process.env.STAFF_PIN_RESET_CODE_FIELD_ID?.trim();
  const resetApprovalEnv = process.env.STAFF_PIN_RESET_APPROVAL_FIELD_ID?.trim();

  return {
    pinCodeFieldId: pinEnv
      ? resolveConfiguredFieldToSchemaUniqueId(pinEnv, appFields)
      : pickFieldUniqueIdByExactCaption(appFields, "PINコード"),
    resetCodeFieldId: resetCodeEnv
      ? resolveConfiguredFieldToSchemaUniqueId(resetCodeEnv, appFields)
      : pickFieldUniqueIdByExactCaption(appFields, "リセット認証コード"),
    resetApprovalFieldId: resetApprovalEnv
      ? resolveConfiguredFieldToSchemaUniqueId(resetApprovalEnv, appFields)
      : pickFieldUniqueIdByExactCaption(appFields, "リセット承認フラグ"),
  };
}

export function staffPinFieldsConfigured(ids: StaffPinFieldIds): boolean {
  return Boolean(
    ids.pinCodeFieldId && ids.resetCodeFieldId && ids.resetApprovalFieldId,
  );
}

export function readStaffPinFieldValue(
  recObj: Record<string, unknown>,
  fieldId: string | null,
): string {
  if (!fieldId) return "";
  const raw = recObj[fieldId];
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string" || typeof raw === "number") {
    return nfkc(String(raw));
  }
  if (typeof raw === "object" && raw !== null && "value" in raw) {
    const v = (raw as { value?: unknown }).value;
    return v === undefined || v === null ? "" : nfkc(String(v));
  }
  return nfkc(String(raw));
}

export function isValidFourDigitPin(raw: string): boolean {
  return /^\d{4}$/.test(nfkc(raw));
}

/** PINコード列が未設定（空白・「-」・4桁以外） */
export function isStaffPinUnset(raw: string): boolean {
  const v = nfkc(raw);
  if (!v || v === "-" || v === "－") return true;
  return !isValidFourDigitPin(v);
}

export function isStaffPinConfigured(raw: string): boolean {
  return !isStaffPinUnset(raw);
}

export function generateStaffResetCode(): string {
  const n = Math.floor(Math.random() * 10_000);
  return String(n).padStart(4, "0");
}

export function isResetApprovalApproved(value: string): boolean {
  return nfkc(value) === STAFF_PIN_RESET_APPROVED;
}
