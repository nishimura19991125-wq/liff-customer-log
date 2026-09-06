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
import { decideApClStaffPut } from "@/lib/customer-info-form/ap-cl-staff-commit";
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
  lookupStaffAssignmentByStaffName,
  resolveStaffAssignmentLookupConfig,
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
 * 担当者由来の自動入力（フォーム非表示の4列）。
 *
 *   AP所属支店・AP所属会社 ← AP担当者の名簿レコード
 *   CL所属支店・CL所属会社 ← CL担当者の名簿レコード
 *
 * **担当者が変わったときだけ引き直し、引けたときだけ書く。**
 * 以前は保存のたびに引き直して、引けなければ "-" で潰していた。
 * 判定は staff-branch-write.ts に切り出してある。
 *
 * ■ 支店と会社を1つの処理でまとめて扱う
 * 担当者が変わったかの判定も、名簿の走査も**1回**。分けて書くと、片方だけ
 * 直したときに気づけない（引き直し条件がずれる・順序がずれる）。
 * 名簿の照会は lookupStaffAssignmentByStaffName が両方まとめて返す。
 *
 * ■ 片方だけ引けたときは、引けたほうだけ書く
 * 「引けない」ことと「値が無い」ことは別。会社が引けなくても支店は書くし、
 * 逆も同じ。どちらも "-" では潰さない。
 */
async function applyStaffAssignmentsToPayload(
  values: CustomerInfoFormValues,
  resolved: CustomerInfoFormFieldResolved[],
  payload: Record<string, unknown>,
  loadedStaff?: { apStaff?: string; clStaff?: string } | null,
): Promise<void> {
  const roles = [
    { role: "AP", staffKey: "apStaff", branchKey: "apBranch", companyKey: "apCompany" },
    { role: "CL", staffKey: "clStaff", branchKey: "clBranch", companyKey: "clCompany" },
  ] as const;

  const targets = roles
    .map((role) => ({
      role: role.role,
      branchFieldId: resolved.find((f) => f.key === role.branchKey)?.fieldId,
      companyFieldId: resolved.find((f) => f.key === role.companyKey)?.fieldId,
      loaded: loadedStaff?.[role.staffKey],
      current: values[role.staffKey],
    }))
    // 支店・会社のどちらの列も解決できない担当者は対象外
    .filter((t) => t.branchFieldId || t.companyFieldId);
  if (targets.length === 0) return;

  const pending = targets.filter((t) =>
    staffBranchNeedsRefresh(t.loaded, t.current),
  );
  // 担当者が両方とも変わっていなければ名簿を読む必要がない
  if (pending.length === 0) return;

  const staffCfg = await resolveStaffAssignmentLookupConfig();
  if (!staffCfg) return;

  for (const t of pending) {
    const assignment = await lookupStaffAssignmentByStaffName(
      t.current,
      staffCfg,
    );
    // 引けなかったら書かない。"-" で潰さない
    const branch = staffBranchValueToWrite(assignment.workplace);
    if (t.branchFieldId && branch !== null) {
      payload[t.branchFieldId] = branch;
    }
    const company = staffBranchValueToWrite(assignment.company);
    if (t.companyFieldId && company !== null) {
      payload[t.companyFieldId] = company;
    }

    /**
     * 引けなかったことを1行残す。
     *
     * 「引けなければ黙って書かない」は値を潰さないための正しい動きだが、
     * **正常系と区別が付かない**。実際、所属会社が取得列に入っていなかった
     * とき（環境変数の設定漏れ）に、画面にもログにも何も出ず切り分けに
     * 時間がかかった。
     *
     * ⚠ 出すのは**取れなかった事実だけ**。担当者の氏名・引けた値・@pocket の
     *   内部情報は出さない。
     * ⚠ **引き直したときだけ**出す。担当者が変わっていない保存でも出すと、
     *   毎回の保存で流れて意味がなくなる（pending の中なのでここは満たす）。
     * 書き込む列が無い側（fieldId が解決できていない）は、そもそも引く必要が
     * 無いので数えない。
     */
    const missing: string[] = [];
    if (t.branchFieldId && branch === null) missing.push("branch");
    if (t.companyFieldId && company === null) missing.push("company");
    if (missing.length > 0) {
      console.warn(
        "[customer-info put-payload] 担当者の所属を名簿から引けませんでした",
        JSON.stringify({ role: t.role, missing }),
      );
    }
  }
}

/**
 * AP/CL担当者は、@pocket の現在値と同じなら payload から落とす（修正3／案F）。
 *
 * ここは PUT /api/customer-info/records/[recordId] が payload を組み立てる
 * 唯一の入口なので、画面の保存でも施工依頼パネルの直接 PUT でも同じように効く。
 * クライアント側の commitApClStaffForSave との二重防御になる。
 *
 * 判定は decideApClStaffPut（純粋関数）に切り出してある。空欄の扱いの
 * 理由もそちらに書いてある。
 */
function applyApClStaffGuardToPayload(
  resolved: CustomerInfoFormFieldResolved[],
  payload: Record<string, unknown>,
  loadedStaff?: { apStaff?: string; clStaff?: string } | null,
): void {
  for (const key of ["apStaff", "clStaff"] as const) {
    const field = resolved.find((f) => f.key === key);
    if (!field?.fieldId) continue;
    if (!Object.prototype.hasOwnProperty.call(payload, field.fieldId)) continue;

    // loadedStaff 自体が null＝レコードの読み取りに失敗している。
    // 列が解決できず undefined のときは「空」として比較する
    const loaded = loadedStaff ? (loadedStaff[key] ?? "") : null;
    const decision = decideApClStaffPut({
      loaded,
      outgoing: String(payload[field.fieldId] ?? ""),
    });
    if (decision.send) continue;

    delete payload[field.fieldId];
    // "unchanged" は設計どおりの通常経路なので出さない（毎回の保存で出て埋もれる）。
    // 空欄・現在値未取得は「想定外の値が来ている」合図なので残す
    if (decision.reason !== "unchanged") {
      console.info(
        `[customer-info put-payload] ${field.label}は送信しません（${decision.reason}）`,
      );
    }
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
  // 契約金額は現金+ローンから引き直す。画面（disabled の表示値）と
  // 保存される値を一致させるため。@pocket 側でも両者は一致する運用
  const synced = syncCombinedNameFields(
    expandNamePartsInValues(syncContractAmountFromPayment(values)),
  );
  const stringPayload = buildCustomerInfoFormPayload(synced, resolved);
  const { resolved: transferResolved } =
    resolveCustomerInfoPtTransferFields(appFields);
  applyCombinedNameFieldsToPayload(synced, resolved, stringPayload);
  applyPtTransferToPayload(values, transferResolved, stringPayload);
  await applyStaffAssignmentsToPayload(
    values,
    resolved,
    stringPayload,
    loadedStaff,
  );
  // 所属支店・所属会社の判定（担当者が変わったときだけ引き直す）が終わって
  // から外す。あちらは values を見て判断しており、payload の増減には
  // 影響されないが、payload を見る形へ変えた瞬間に壊れる。順序は保つこと
  applyApClStaffGuardToPayload(resolved, stringPayload, loadedStaff);
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
