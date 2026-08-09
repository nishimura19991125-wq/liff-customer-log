import { NextResponse } from "next/server";

import { pocketErrorResponse } from "@/lib/api-error-response";
import { fetchAppFields, fetchRecordById, updateRecord } from "@/lib/atpocket";
import { auditLogEnabled, recordAuditLog } from "@/lib/audit-log";
import type { AuditLogFieldChange } from "@/lib/audit-log-changes";
import { computeAuditChanges } from "@/lib/audit-log-changes";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import {
  documentUploadMaxBytes,
  storeCustomerDocumentFile,
} from "@/lib/customer-document-upload";
import { customerDocumentSpecByKey } from "@/lib/customer-documents-spec";
import {
  customerInfoConfigReady,
  customerInfoImportKeyFieldId,
  customerInfoImportKeySourceFieldIds,
  customerInfoPocketAuth1,
  customerInfoPocketAuthWrite,
} from "@/lib/customer-info-config";
import { resolveCustomerInfoDropboxLinkFieldId } from "@/lib/customer-info-dropbox-link";
import { attachCustomerInfoImportKeyToPayload } from "@/lib/customer-info-form/put-payload";
import { resolveCustomerInfoFormFieldId } from "@/lib/customer-info-form/resolve-fields";
import {
  customerInfoPutValue,
  fieldCaptionByUniqueId,
  readCustomerInfoFieldValue,
  readCustomerInfoImportKeyFromRecord,
} from "@/lib/customer-info-record";
import { documentExtensionFromFileName } from "@/lib/document-upload-name";
import { dropboxConfigured, dropboxCustomerFolderPath } from "@/lib/dropbox";
import { buildCustomerFolderName } from "@/lib/dropbox-folder-name";
import { invalidateCustomerInfoKeyLookupCache } from "@/lib/customer-info-key-lookup-cache";
import { invalidateCustomerInfoPendingCache } from "@/lib/customer-info-pending-cache";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { consumeRateLimit } from "@/lib/simple-rate-limit";

export const dynamic = "force-dynamic";
/** Netlify Pro 等で延長可能。Free はプラットフォーム上限（約10秒） */
export const maxDuration = 26;

type RouteCtx = { params: Promise<{ recordId: string }> };

/** 同一 LINE userId からの連続アップロード上限（既定 20ファイル/分） */
function uploadRateLimit(): { windowMs: number; max: number } {
  const raw = process.env.DOCUMENT_UPLOAD_MAX_PER_MINUTE?.trim();
  const n = raw ? Number(raw) : 20;
  const max = Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
  return { windowMs: 60_000, max };
}

const STATUS_UPDATE_FAILED_MESSAGE =
  "ファイルは保存されましたが、ステータスの更新に失敗しました。手動で変更してください。";

/**
 * 書類ファイルのアップロード（タスクF）。
 *
 * 通常の保存（PUT /api/customer-info/records/[recordId]）とは**分離**している。
 * 混ぜると、アップロードの失敗で通常の編集保存まで巻き添えになる。
 *
 * 順序が重要:
 *   Dropbox への格納が成功したことを確認してから @pocket のステータスを更新する。
 *   格納に失敗したらステータスは触らない。
 */
export async function POST(request: Request, ctx: RouteCtx) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  if (!consumeRateLimit(`doc-upload:${auth.lineUserId}`, uploadRateLimit())) {
    return NextResponse.json(
      {
        error:
          "アップロードが集中しています。1分ほど待ってから残りのファイルを送信してください。",
      },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const cfg = customerInfoConfigReady();
  if (!cfg.ok) {
    return NextResponse.json(
      { error: cfg.error, disabled: true },
      { status: 503 },
    );
  }

  if (!dropboxConfigured()) {
    return NextResponse.json(
      { error: "Dropbox 連携が未設定のため、書類をアップロードできません。" },
      { status: 503 },
    );
  }

  const { recordId: recordIdRaw } = await ctx.params;
  const recordId = recordIdRaw?.trim();
  if (!recordId) {
    return NextResponse.json({ error: "recordId が必要です" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "multipart/form-data で送信してください" },
      { status: 400 },
    );
  }

  // ── 項目キーの検証（任意の列を更新させない）──────────────
  const documentKey = String(form.get("documentKey") ?? "").trim();
  const spec = customerDocumentSpecByKey(documentKey);
  if (!spec) {
    return NextResponse.json(
      { error: "書類の項目が不正です" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "ファイルが選択されていません" },
      { status: 400 },
    );
  }

  const maxBytes = documentUploadMaxBytes();
  if (file.size <= 0) {
    return NextResponse.json({ error: "空のファイルです" }, { status: 400 });
  }
  if (file.size > maxBytes) {
    const mb = Math.floor(maxBytes / 1_000_000);
    return NextResponse.json(
      {
        error: `ファイルサイズが大きすぎます（上限${mb}MB）。分割するか、画質を下げて再撮影してください。`,
      },
      { status: 413 },
    );
  }

  // ── 拡張子のみ元ファイルから採る（ファイル名は信用しない）──
  const extension = documentExtensionFromFileName(file.name ?? "");
  if (!extension) {
    return NextResponse.json(
      {
        error:
          "対応していないファイル形式です（PDF・JPG・PNG・HEIC のみ送信できます）",
      },
      { status: 415 },
    );
  }

  const readAuth = customerInfoPocketAuth1();
  const writeAuth = customerInfoPocketAuthWrite();

  try {
    const appFields = await fetchAppFields(cfg.appId, readAuth, {
      operation: "customer-info:書類アップロード(列定義)",
      appEnv: "CUSTOMER_INFO_APP_ID",
    });

    const row = await fetchRecordById(cfg.appId, recordId, readAuth);
    if (!row?.record || typeof row.record !== "object") {
      return NextResponse.json(
        { error: "レコードが見つかりません" },
        { status: 404 },
      );
    }
    const recObj = row.record as Record<string, unknown>;

    // ── Dropboxリンクが空なら受け付けない（画面の制御だけに頼らない）──
    const linkFieldId = resolveCustomerInfoDropboxLinkFieldId(appFields);
    const dropboxLink = linkFieldId
      ? readCustomerInfoFieldValue(recObj, linkFieldId).trim()
      : "";
    if (!dropboxLink) {
      return NextResponse.json(
        {
          error:
            "Dropboxフォルダが未設定のため、書類のアップロードはできません。",
          dropboxFolderConfigured: false,
        },
        { status: 400 },
      );
    }

    // ── フォルダのパスを解決（タスクEと同じ組み立て）──────────
    const nameFieldId = resolveCustomerInfoFormFieldId(
      "customerName",
      "お客様名",
      appFields,
    );
    const customerName = nameFieldId
      ? readCustomerInfoFieldValue(recObj, nameFieldId).trim()
      : "";

    const importKeyEnv = customerInfoImportKeyFieldId();
    const importKeySchema = importKeyEnv
      ? resolveConfiguredFieldToSchemaUniqueId(importKeyEnv, appFields)
      : null;
    const tNumber = importKeySchema
      ? readCustomerInfoImportKeyFromRecord(
          recObj,
          importKeySchema,
          customerInfoImportKeySourceFieldIds(),
        ).trim()
      : "";

    const folderName =
      tNumber && customerName
        ? buildCustomerFolderName(tNumber, customerName)
        : null;
    const folderPath = folderName ? dropboxCustomerFolderPath(folderName) : null;
    if (!folderPath) {
      console.error(
        "[api/customer-info/documents/upload] フォルダ名を組み立てられません",
        {
          recordId,
          hasTNumber: Boolean(tNumber),
          hasCustomerName: Boolean(customerName),
        },
      );
      return NextResponse.json(
        {
          error:
            "顧客フォルダを特定できませんでした（T番号またはお客様名が未入力です）。",
        },
        { status: 400 },
      );
    }

    const docFieldId = resolveCustomerInfoFormFieldId(
      spec.key,
      spec.caption,
      appFields,
    );
    if (!docFieldId) {
      return NextResponse.json(
        {
          error: `「${spec.caption}」列を @pocket 上で特定できませんでした。`,
        },
        { status: 500 },
      );
    }

    // ── Dropbox へ格納（ここが失敗したらステータスは触らない）──
    const bytes = new Uint8Array(await file.arrayBuffer());
    const stored = await storeCustomerDocumentFile({
      folderPath,
      caption: spec.caption,
      customerName,
      extension,
      bytes,
    });

    // ── 格納成功。ここからステータス更新 ─────────────────
    const previousStatus = readCustomerInfoFieldValue(recObj, docFieldId);
    const payload: Record<string, unknown> = {
      [docFieldId]: spec.completedValue,
    };

    let statusUpdated = false;
    let statusError: string | null = null;
    try {
      const keyResult = await attachCustomerInfoImportKeyToPayload(
        cfg.appId,
        recordId,
        writeAuth,
        appFields,
        payload,
      );
      if (!keyResult.ok) throw new Error(keyResult.error);

      const normalized: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(payload)) {
        normalized[k] = customerInfoPutValue(v);
      }
      await updateRecord(cfg.appId, recordId, normalized, writeAuth);
      statusUpdated = true;
      invalidateCustomerInfoPendingCache();
      invalidateCustomerInfoKeyLookupCache();
    } catch (e) {
      // ファイルは既に Dropbox にある。握り潰さず画面へ伝える
      console.error(
        `[api/customer-info/documents/upload] ステータス更新に失敗（ファイルは格納済み）: recordId=${recordId} key=${spec.key} fileName=${stored.fileName}`,
        e,
      );
      statusError = STATUS_UPDATE_FAILED_MESSAGE;
    }

    // ── 監査ログ（ベストエフォート）──────────────────────
    if (auditLogEnabled()) {
      const changes: AuditLogFieldChange[] = [];
      if (statusUpdated) {
        changes.push(
          ...computeAuditChanges(
            { [docFieldId]: previousStatus },
            { [docFieldId]: spec.completedValue },
            { labelOf: (id) => fieldCaptionByUniqueId(appFields, id) },
          ),
        );
      }
      // Dropbox 側にはアプリのトークンで書くため操作者が残らない。
      // 「いつ誰が何を上げたか」はこの監査ログが唯一の記録になる。
      changes.push({
        fieldId: `${docFieldId}:file`,
        label: spec.caption,
        before: "",
        after: stored.fileName,
      });
      await recordAuditLog({
        lineUserId: auth.lineUserId,
        operation: "update",
        targetAppId: cfg.appId,
        targetRecordId: recordId,
        targetTNumber: tNumber,
        changes,
      });
    }

    return NextResponse.json({
      ok: true,
      fileName: stored.fileName,
      documentKey: spec.key,
      statusUpdated,
      ...(statusUpdated ? { status: spec.completedValue } : {}),
      ...(statusError ? { warning: statusError } : {}),
    });
  } catch (e) {
    // Dropbox の本文には内部パス構造が載るためクライアントへは返さない
    return pocketErrorResponse(e, {
      scope: "api/customer-info/records/[recordId]/documents/upload",
      message:
        "ファイルのアップロードに失敗しました。時間をおいて再度お試しください。",
    });
  }
}
