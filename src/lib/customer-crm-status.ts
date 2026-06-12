import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import { customerInfoCustomerStatusFieldId } from "@/lib/customer-info-config";
import { isCustomerStatusCancelled } from "@/lib/customer-status-label";
import { resolveCustomerInfoFormFieldId } from "@/lib/customer-info-form/resolve-fields";
import { readCustomerInfoFieldValue } from "@/lib/customer-info-record";

/**
 * 顧客ステータス列の uniqueId。
 * CUSTOMER_INFO_CUSTOMER_STATUS_FIELD_ID が設定されていればそれのみ使用（見出し自動判定は使わない）。
 */
export function resolveCrmCustomerStatusFieldId(
  appFields: AtPocketFieldRow[],
): string | null {
  const fromEnv = customerInfoCustomerStatusFieldId();
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

/** キャンセル案件は書類未回収アラート・一覧の対象外 */
export function crmEffectiveDocumentMissing(
  isDocumentMissing: boolean,
  isCancelled: boolean,
): boolean {
  return isDocumentMissing && !isCancelled;
}
