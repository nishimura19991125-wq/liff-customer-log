import "server-only";

import type { AtPocketFetchAuth, AtPocketFieldRow } from "@/lib/atpocket";
import { fetchRecordById } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import {
  customerInfoImportKeyFieldId,
  customerInfoImportKeySourceFieldIds,
} from "@/lib/customer-info-config";
import {
  customerInfoPutValue,
  readCustomerInfoImportKeyFromRecord,
} from "@/lib/customer-info-record";
import { syncContractAmountFromPayment } from "@/lib/customer-info-form/form-change";
import { computePtTransfer } from "@/lib/customer-info-form/pt-transfer";
import { buildCustomerInfoFormPayload } from "@/lib/customer-info-form/rules";
import { resolveCustomerInfoPtTransferFields } from "@/lib/customer-info-form/resolve-fields";
import type {
  CustomerInfoFormFieldResolved,
  CustomerInfoFormValues,
} from "@/lib/customer-info-form/types";

/** 取込キー（T番号）を payload に付与 */
export async function attachCustomerInfoImportKeyToPayload(
  appId: string,
  recordId: string,
  pocketAuth: AtPocketFetchAuth,
  appFields: AtPocketFieldRow[],
  payload: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const importKeyEnv = customerInfoImportKeyFieldId();
  if (!importKeyEnv) return { ok: true };

  const importKeySchema = resolveConfiguredFieldToSchemaUniqueId(
    importKeyEnv,
    appFields,
  );
  if (!importKeySchema) {
    return {
      ok: false,
      status: 500,
      error: `取込キー（T番号）フィールド「${importKeyEnv}」がアプリ定義と一致しません。CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID を確認してください。`,
    };
  }

  if (Object.prototype.hasOwnProperty.call(payload, importKeySchema)) {
    return { ok: true };
  }

  const fieldsCsv = [
    importKeySchema,
    ...customerInfoImportKeySourceFieldIds(),
  ].join(",");
  let row = await fetchRecordById(appId, recordId, pocketAuth, fieldsCsv);
  if (!row?.record) {
    row = await fetchRecordById(appId, recordId, pocketAuth);
  }
  if (!row?.record || typeof row.record !== "object") {
    return { ok: false, status: 404, error: "レコードが見つかりません" };
  }
  const recObj = row.record as Record<string, unknown>;
  const keyValue = readCustomerInfoImportKeyFromRecord(
    recObj,
    importKeySchema,
    customerInfoImportKeySourceFieldIds(),
  );
  if (!keyValue) {
    return {
      ok: false,
      status: 400,
      error:
        "このレコードの T番号（取込キー）を取得できませんでした。@pocket に T番号 が入っているか、CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID が「T番号」列の識別名と一致しているか確認してください。",
    };
  }
  payload[importKeySchema] = keyValue;
  return { ok: true };
}

function applyPtTransferToPayload(
  values: CustomerInfoFormValues,
  transferResolved: CustomerInfoFormFieldResolved[],
  payload: Record<string, unknown>,
): void {
  const { clpt, appt } = computePtTransfer(values);
  for (const field of transferResolved) {
    if (field.key === "clpt") payload[field.fieldId] = clpt;
    if (field.key === "appt") payload[field.fieldId] = appt;
  }
}

export function formPayloadFromValues(
  values: CustomerInfoFormValues,
  resolved: CustomerInfoFormFieldResolved[],
  appFields: AtPocketFieldRow[],
): Record<string, unknown> {
  const synced = syncContractAmountFromPayment(values);
  const stringPayload = buildCustomerInfoFormPayload(synced, resolved);
  const { resolved: transferResolved } =
    resolveCustomerInfoPtTransferFields(appFields);
  applyPtTransferToPayload(values, transferResolved, stringPayload);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(stringPayload)) {
    out[k] = v;
  }
  return out;
}
