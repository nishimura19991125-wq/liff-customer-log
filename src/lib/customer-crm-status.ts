import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import type { CrmDocumentCheckItem } from "@/lib/customer-crm-documents";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import { customerInfoCustomerStatusFieldId } from "@/lib/customer-info-config";
import {
  isCustomerStatusCancelled,
  isCustomerStatusCompleted,
} from "@/lib/customer-status-label";
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

/** 顧客ステータスが「完了」か（完工・残工は含めない） */
export function recordIsCustomerStatusCompleted(
  recObj: Record<string, unknown>,
  fieldId: string | null,
): boolean {
  return isCustomerStatusCompleted(
    readCustomerStatusFromRecord(recObj, fieldId),
  );
}

/**
 * キャンセル案件は書類未回収アラート・一覧の対象外。
 *
 * **書類のキャンセル判定はこの1関数だけ。** 行ごとのバッジ
 * （crmEffectiveDocumentItems）もここから導出しており、
 * 総合バッジと行バッジで扱いがずれないようにしている。
 */
export function crmEffectiveDocumentMissing(
  isDocumentMissing: boolean,
  isCancelled: boolean,
): boolean {
  return isDocumentMissing && !isCancelled;
}

/**
 * キャンセル案件は補助金対象のアラートにも出さない。
 *
 * 書類未回収・入力ステータスと同じ扱いに揃える。判定が一部にしか
 * 入っていないと、後から片方だけ直してズレる。
 *
 * 補助金名（combinedSubsidyName）は消さない。書類の value と同じで、
 * 実際の内容はキャンセル案件でも確認できる。
 */
export function crmEffectiveSubsidyTarget(
  isSubsidyTarget: boolean,
  isCancelled: boolean,
): boolean {
  return isSubsidyTarget && !isCancelled;
}

/**
 * 書類チェックリストの行ごとの未回収バッジにも、同じキャンセル判定を効かせる。
 *
 * 総合バッジ（⚠️ 書類未回収）だけ消して行が赤いままだと、キャンセルした案件で
 * 「書類が足りません」と言われ続けているように見える。
 *
 * 値（value）は書き換えない。実際の回収状況は一覧でそのまま確認できる。
 */
export function crmEffectiveDocumentItems(
  documents: readonly CrmDocumentCheckItem[],
  isCancelled: boolean,
): CrmDocumentCheckItem[] {
  return documents.map((doc) => {
    const isMissing = crmEffectiveDocumentMissing(doc.isMissing, isCancelled);
    return isMissing === doc.isMissing ? doc : { ...doc, isMissing };
  });
}
