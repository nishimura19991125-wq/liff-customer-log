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
  buildCombinedNormalAddress,
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

/**
 * 「基本情報」の並び。**ここが唯一の定義**。
 *
 * 以前は画面が「工事日・補助金有無を固定行で描画」＋「summary をそのまま列挙」
 * という二本立てで、補助金有無が両方に現れて重複していた。
 * 並びも値の組み立ても、この関数の中で1本にまとめている。
 *
 * 住所・工事日・補助金有無は単純な列読みではないため、caption 検索とは別に積む。
 * 書類フォルダ（Dropboxリンク）は summary ではなく dropboxLink として返し、
 * 画面が最後の行に描く。
 */

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
  const seenFieldIds = new Set<string>();

  /** 見出し一致で1列読む。空・「-」の行は出さない（従来どおり） */
  const pushByCaption = (caption: string): void => {
    const lower = caption.toLowerCase();
    for (const f of appFields) {
      const fCap = f.caption ? String(f.caption).trim() : "";
      if (!fCap || fCap.toLowerCase() !== lower) continue;
      const id = f.uniqueId?.trim();
      if (!id || seenFieldIds.has(id)) return;
      const value = readCustomerInfoFieldValue(recObj, id);
      if (value && value !== "-") {
        summary.push({ label: fCap, value });
        seenFieldIds.add(id);
      }
      return;
    }
  };

  /** 組み立て済みの値。空でも行は残す（従来の固定行と同じ挙動） */
  const pushValue = (label: string, value: string): void => {
    summary.push({ label, value: value || "—" });
  };

  // 都道府県＋市区郡まで。番地以降は出さない。
  // 列の解決は map-address-fields.ts（タスクH のフォームと同じ prefecture / city）を再利用する
  const addressPrefCity = buildCombinedNormalAddress({
    prefecture: mapAddressIds.prefectureFieldId
      ? readCustomerInfoFieldValue(recObj, mapAddressIds.prefectureFieldId)
      : "",
    city: mapAddressIds.cityFieldId
      ? readCustomerInfoFieldValue(recObj, mapAddressIds.cityFieldId)
      : "",
    street: "",
  });

  pushByCaption("T番号");
  if (addressPrefCity) summary.push({ label: "住所", value: addressPrefCity });
  pushByCaption("設置種別");
  pushValue("工事日", constructionDate);
  pushValue("補助金有無", subsidyPresence ?? "");
  pushByCaption("導入経緯");
  pushByCaption("AP担当者");
  pushByCaption("CL担当者");
  pushByCaption("案件作成者");
  pushByCaption("入力ステータス");

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
