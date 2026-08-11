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
import {
  expandNamePartsInValues,
  syncCombinedNameFields,
} from "@/lib/customer-info-form/name-parts";
import { computePtTransfer } from "@/lib/customer-info-form/pt-transfer";
import {
  staffBranchNeedsRefresh,
  staffBranchValueToWrite,
} from "@/lib/customer-info-form/staff-branch-write";
import { filterCustomerInfoPutPayload } from "@/lib/customer-info-form/pocket-writable-fields";
import {
  buildCustomerInfoFormPayload,
  isCustomerInfoFormFieldVisible,
} from "@/lib/customer-info-form/rules";
import { lookupBatteryModelNumberByCapacity } from "@/lib/product-catalog-models";
import { resolveCustomerInfoPtTransferFields } from "@/lib/customer-info-form/resolve-fields";
import type {
  CustomerInfoFormFieldResolved,
  CustomerInfoFormValues,
} from "@/lib/customer-info-form/types";
import {
  lookupStaffWorkplaceByStaffName,
  resolveStaffWorkplaceLookupConfig,
} from "@/lib/staff-workplace-lookup";

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

const BRANCH_FALLBACK = "-";

/**
 * AP所属支店＝AP担当者の名簿レコードの勤務場所、CL所属支店＝CL担当者の勤務場所
 * （フォーム非表示）。
 *
 * **担当者が変わったときだけ引き直し、引けたときだけ書く。**
 * 以前は保存のたびに引き直して、引けなければ "-" で潰していた。
 * 判定は staff-branch-write.ts に切り出してある。
 */
async function applyStaffBranchesToPayload(
  values: CustomerInfoFormValues,
  resolved: CustomerInfoFormFieldResolved[],
  payload: Record<string, unknown>,
  loadedStaff?: { apStaff?: string; clStaff?: string } | null,
): Promise<void> {
  const apBranchField = resolved.find((f) => f.key === "apBranch");
  const clBranchField = resolved.find((f) => f.key === "clBranch");
  if (!apBranchField?.fieldId && !clBranchField?.fieldId) return;

  const targets: Array<{ fieldId: string; loaded?: string; current?: string }> =
    [];
  if (apBranchField?.fieldId) {
    targets.push({
      fieldId: apBranchField.fieldId,
      loaded: loadedStaff?.apStaff,
      current: values.apStaff,
    });
  }
  if (clBranchField?.fieldId) {
    targets.push({
      fieldId: clBranchField.fieldId,
      loaded: loadedStaff?.clStaff,
      current: values.clStaff,
    });
  }

  const pending = targets.filter((t) =>
    staffBranchNeedsRefresh(t.loaded, t.current),
  );
  // 担当者が両方とも変わっていなければ名簿を読む必要がない
  if (pending.length === 0) return;

  const staffCfg = await resolveStaffWorkplaceLookupConfig();
  if (!staffCfg) return;

  for (const t of pending) {
    const workplace = await lookupStaffWorkplaceByStaffName(
      t.current,
      staffCfg,
    );
    const value = staffBranchValueToWrite(workplace);
    // 引けなかったら書かない。"-" で潰さない
    if (value === null) continue;
    payload[t.fieldId] = value;
  }
}

/** お客様名・フリガナ（フォームは苗字/名前分割・@pocket は単一列） */
function applyCombinedNameFieldsToPayload(
  values: CustomerInfoFormValues,
  resolved: CustomerInfoFormFieldResolved[],
  payload: Record<string, unknown>,
): void {
  const synced = syncCombinedNameFields(values);
  const customerNameField = resolved.find((f) => f.key === "customerName");
  const furiganaField = resolved.find((f) => f.key === "furigana");
  if (customerNameField?.fieldId) {
    payload[customerNameField.fieldId] = (synced.customerName ?? "").trim();
  }
  if (furiganaField?.fieldId) {
    payload[furiganaField.fieldId] = (synced.furigana ?? "").trim();
  }
}

/** 蓄電池品番①②＝商品一覧の型番（選択した蓄電池容量と同一レコード・フォーム非表示） */
async function applyBatteryModelNumbersToPayload(
  values: CustomerInfoFormValues,
  resolved: CustomerInfoFormFieldResolved[],
  payload: Record<string, unknown>,
): Promise<void> {
  const model1Field = resolved.find((f) => f.key === "batteryModel1");
  const model2Field = resolved.find((f) => f.key === "batteryModel2");
  if (!model1Field?.fieldId && !model2Field?.fieldId) return;

  const manufacturer = (values.manufacturer ?? "").trim();

  async function modelForCapacity(
    capacityKey: "batteryCapacity1" | "batteryCapacity2",
  ): Promise<string> {
    if (!isCustomerInfoFormFieldVisible(capacityKey, values)) {
      return BRANCH_FALLBACK;
    }
    const capacity = (values[capacityKey] ?? "").trim();
    if (!capacity || capacity === "-") return BRANCH_FALLBACK;
    if (!manufacturer) return BRANCH_FALLBACK;
    const model = await lookupBatteryModelNumberByCapacity(
      manufacturer,
      capacity,
    );
    return model?.trim() || BRANCH_FALLBACK;
  }

  if (model1Field?.fieldId) {
    payload[model1Field.fieldId] = await modelForCapacity("batteryCapacity1");
  }
  if (model2Field?.fieldId) {
    payload[model2Field.fieldId] = await modelForCapacity("batteryCapacity2");
  }
}

export async function formPayloadFromValues(
  values: CustomerInfoFormValues,
  resolved: CustomerInfoFormFieldResolved[],
  appFields: AtPocketFieldRow[],
  pocketAuth: AtPocketFetchAuth,
  /**
   * @pocket に入っている現在の AP/CL担当者。所属支店を引き直すかどうかの
   * 判定にだけ使う。取れなかったときは省略してよい（従来どおり引き直す）
   */
  loadedStaff?: { apStaff?: string; clStaff?: string } | null,
): Promise<Record<string, unknown>> {
  const synced = syncCombinedNameFields(
    expandNamePartsInValues(syncContractAmountFromPayment(values)),
  );
  const stringPayload = buildCustomerInfoFormPayload(synced, resolved);
  const { resolved: transferResolved } =
    resolveCustomerInfoPtTransferFields(appFields);
  applyCombinedNameFieldsToPayload(synced, resolved, stringPayload);
  applyPtTransferToPayload(values, transferResolved, stringPayload);
  await applyStaffBranchesToPayload(
    values,
    resolved,
    stringPayload,
    loadedStaff,
  );
  await applyBatteryModelNumbersToPayload(values, resolved, stringPayload);
  const { payload: filtered, dropped } = filterCustomerInfoPutPayload(
    stringPayload,
    appFields,
    resolved,
  );
  if (dropped.length > 0) {
    console.warn(
      "[customer-info put-payload]",
      dropped.map((d) => ({
        fieldId: d.fieldId,
        formKey: d.formKey,
        label: d.label,
        reason: d.reason,
      })),
    );
  }
  return filtered;
}
