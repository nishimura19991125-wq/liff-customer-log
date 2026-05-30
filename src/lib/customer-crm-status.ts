import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import { isCustomerStatusCancelled } from "@/lib/customer-status-label";
import { resolveCustomerInfoFormFieldId } from "@/lib/customer-info-form/resolve-fields";
import { readCustomerInfoFieldValue } from "@/lib/customer-info-record";

/** 顧客ステータス列の uniqueId（未設定時は見出し「顧客ステータス」） */
export function resolveCrmCustomerStatusFieldId(
  appFields: AtPocketFieldRow[],
): string | null {
  const fromEnv = process.env.CUSTOMER_INFO_CUSTOMER_STATUS_FIELD_ID?.trim();
  if (fromEnv) {
    return resolveConfiguredFieldToSchemaUniqueId(fromEnv, appFields);
  }
  return resolveCustomerInfoFormFieldId(
    "customerStatus",
    "顧客ステータス",
    appFields,
  );
}

export function readCustomerStatusFromRecord(
  recObj: Record<string, unknown>,
  fieldId: string | null,
): string {
  if (!fieldId) return "";
  return readCustomerInfoFieldValue(recObj, fieldId);
}

export function recordIsCustomerStatusCancelled(
  recObj: Record<string, unknown>,
  fieldId: string | null,
): boolean {
  return isCustomerStatusCancelled(
    readCustomerStatusFromRecord(recObj, fieldId),
  );
}
