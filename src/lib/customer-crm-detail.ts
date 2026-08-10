import "server-only";

import {
  customerInfoAppId,
  customerInfoConfigReady,
  customerInfoNameFieldId,
  customerInfoPocketAuth,
  customerInfoSubtitleFieldId,
} from "@/lib/customer-info-config";
import {
  evaluateCrmDocuments,
  isCrmConstructionDateUnset,
  buildCrmSubsidyInfo,
  resolveCrmConstructionDateFieldId,
  resolveCrmDocumentFields,
  resolveCrmSubsidyFieldIds,
} from "@/lib/customer-crm-documents";
import {
  matchCustomerInfoPendingAudience,
  resolveCustomerInfoCreatorFieldId,
} from "@/lib/customer-info-creator-field";
import {
  crmEffectiveDocumentMissing,
  recordIsCustomerStatusCancelled,
  resolveCrmCustomerStatusFieldId,
} from "@/lib/customer-crm-status";
import { resolveCustomerInfoDropboxLinkFieldId } from "@/lib/customer-info-dropbox-link";
import { resolveCustomerInfoFormFieldId } from "@/lib/customer-info-form/resolve-fields";
import { safeHttpsUrl } from "@/lib/safe-external-url";
import {
  readCustomerInfoFieldValue,
} from "@/lib/customer-info-record";
import type { CrmDocumentCheckItem } from "@/lib/customer-crm-documents";
import { fetchAppFields, fetchRecordById } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import {
  readMapAddressesFromRecord,
  resolveCustomerInfoMapAddressFieldIds,
} from "@/lib/map-address-fields";

export type CustomerCrmDetail = {
  recordId: string;
  customerName: string;
  subtitle: string;
  isDocumentMissing: boolean;
  isSubsidyTarget: boolean;
  combinedSubsidyName: string | null;
  isConstructionDateUnset: boolean;
  isCancelled: boolean;
  constructionDate: string;
  /** 補助金有無の生の値（「無」含む） */
  subsidyPresence: string;
  documents: CrmDocumentCheckItem[];
  summary: Array<{ label: string; value: string }>;
  pinpointAddress: string;
  normalAddress: string;
  /**
   * Dropbox 顧客フォルダの共有リンク（タスクE の「Dropboxリンク」列）。
   *
   * 値は人が入力しうる列なので、https:// のものだけを通してから返す。
   * 通らなかった場合は空文字（画面では「未設定」）。
   */
  dropboxLink: string;
};

const SUMMARY_CAPTIONS = [
  "AP担当者",
  "CL担当者",
  "案件作成者",
  "入力ステータス",
  "補助金有無",
  "補助金利用",
  "工事日",
  "施工予定日",
  "お客様名",
  "T番号",
  "設置種別",
  "お支払方法",
] as const;

export async function fetchCustomerCrmDetail(
  recordId: string,
  boundStaffName: string,
): Promise<
  | { ok: true; detail: CustomerCrmDetail }
  | { ok: false; status: number; error: string }
> {
  const cfg = customerInfoConfigReady();
  if (!cfg.ok) {
    return { ok: false, status: 503, error: cfg.error };
  }

  const appId = customerInfoAppId();
  if (!appId) {
    return { ok: false, status: 503, error: "CUSTOMER_INFO_APP_ID が未設定です" };
  }

  const auth = customerInfoPocketAuth();
  const pocketCtx = {
    operation: "customer-crm:顧客詳細",
    appEnv: "CUSTOMER_INFO_APP_ID",
  } as const;

  const appFields = await fetchAppFields(appId, auth, pocketCtx);
  const nameField = resolveConfiguredFieldToSchemaUniqueId(
    customerInfoNameFieldId()!,
    appFields,
  );
  if (!nameField) {
    return { ok: false, status: 502, error: "お客様名列を解決できません" };
  }

  const subtitleEnv = customerInfoSubtitleFieldId();
  const subtitleField = subtitleEnv
    ? resolveConfiguredFieldToSchemaUniqueId(subtitleEnv, appFields)
    : null;

  const apFieldId = resolveCustomerInfoFormFieldId(
    "apStaff",
    "AP担当者",
    appFields,
  );
  const clFieldId = resolveCustomerInfoFormFieldId(
    "clStaff",
    "CL担当者",
    appFields,
  );
  const creatorFieldId = resolveCustomerInfoCreatorFieldId(appFields);
  const docFields = resolveCrmDocumentFields(appFields);
  const constructionDateFieldId = resolveCrmConstructionDateFieldId(appFields);
  const subsidyFieldIds = resolveCrmSubsidyFieldIds(appFields);
  const mapAddressIds = resolveCustomerInfoMapAddressFieldIds(appFields);
  const customerStatusFieldId = resolveCrmCustomerStatusFieldId(appFields);
  // 列の解決はタスクE と同じ関数を使う（環境変数 → 見出し完全一致）
  const dropboxLinkFieldId = resolveCustomerInfoDropboxLinkFieldId(appFields);

  const row = await fetchRecordById(appId, recordId, auth);
  if (!row?.record || typeof row.record !== "object") {
    return { ok: false, status: 404, error: "レコードが見つかりません" };
  }
  const rec = row.record;

  const recObj = rec as Record<string, unknown>;

  if (
    !matchCustomerInfoPendingAudience(
      recObj,
      boundStaffName,
      apFieldId,
      clFieldId,
      creatorFieldId,
    )
  ) {
    return { ok: false, status: 403, error: "この案件を表示する権限がありません" };
  }

  const isCancelled = recordIsCustomerStatusCancelled(
    recObj,
    customerStatusFieldId,
  );
  const { isDocumentMissing: rawDocumentMissing, documents } =
    evaluateCrmDocuments(recObj, docFields);
  const isDocumentMissing = crmEffectiveDocumentMissing(
    rawDocumentMissing,
    isCancelled,
  );
  const {
    isSubsidyTarget,
    combinedSubsidyName,
    subsidyPresence,
  } = buildCrmSubsidyInfo(recObj, subsidyFieldIds);
  const constructionDate = constructionDateFieldId
    ? readCustomerInfoFieldValue(recObj, constructionDateFieldId)
    : "";
  const { pinpointAddress, normalAddress } = readMapAddressesFromRecord(
    recObj,
    mapAddressIds,
  );

  const summary: Array<{ label: string; value: string }> = [];
  const seen = new Set<string>();
  for (const cap of SUMMARY_CAPTIONS) {
    const lower = cap.toLowerCase();
    if (seen.has(lower)) continue;
    for (const f of appFields) {
      const fCap = f.caption ? String(f.caption).trim() : "";
      if (!fCap || fCap.toLowerCase() !== lower) continue;
      const id = f.uniqueId?.trim();
      if (!id || seen.has(id)) continue;
      const value = readCustomerInfoFieldValue(recObj, id);
      if (value && value !== "-") {
        summary.push({ label: fCap, value });
        seen.add(id);
      }
      break;
    }
  }

  return {
    ok: true,
    detail: {
      recordId,
      customerName: readCustomerInfoFieldValue(recObj, nameField),
      subtitle: subtitleField
        ? readCustomerInfoFieldValue(recObj, subtitleField)
        : "",
      isDocumentMissing,
      isSubsidyTarget,
      combinedSubsidyName,
      isConstructionDateUnset: isCrmConstructionDateUnset(
        recObj,
        constructionDateFieldId,
      ),
      isCancelled,
      constructionDate: constructionDate || "—",
      subsidyPresence: subsidyPresence || "—",
      documents,
      summary,
      pinpointAddress,
      normalAddress,
      dropboxLink: dropboxLinkFieldId
        ? (safeHttpsUrl(
            readCustomerInfoFieldValue(recObj, dropboxLinkFieldId),
          ) ?? "")
        : "",
    },
  };
}
