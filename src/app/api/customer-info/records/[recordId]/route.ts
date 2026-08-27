import { NextResponse } from "next/server";

import { pocketErrorResponse } from "@/lib/api-error-response";

import {
  customerInfoConfigReady,
  customerInfoEditableFieldIds,
  customerInfoImportKeyFieldId,
  customerInfoPocketAuth,
  customerInfoPocketAuth1,
  customerInfoPocketAuthWrite,
  customerInfoSubtitleFieldId,
  customerInfoUsesLegacyEditableList,
} from "@/lib/customer-info-config";
import { attachCustomerInfoImportKeyToPayload } from "@/lib/customer-info-form/put-payload";
import { formPayloadFromValues } from "@/lib/customer-info-form/put-payload";
import {
  expandNamePartsInValues,
  syncCombinedNameFields,
} from "@/lib/customer-info-form/name-parts";
import {
  findMissingRequiredCustomerInfoFields,
  formatCustomerInfoRequiredValidationError,
} from "@/lib/customer-info-form/validate";
import {
  formValuesFromPutBody,
  readCustomerInfoFormValuesFromRecord,
  resolveCustomerInfoFormFieldId,
  resolveCustomerInfoFormFields,
  resolveCustomerInfoPtTransferFields,
} from "@/lib/customer-info-form/resolve-fields";
import {
  customerInfoPutValue,
  fieldCaptionByUniqueId,
  readCustomerInfoFieldValue,
  resolveCustomerInfoFieldIds,
} from "@/lib/customer-info-record";
import type { AtPocketFetchAuth, AtPocketFieldRow } from "@/lib/atpocket";
import {
  fetchAppFields,
  fetchRecordById,
  updateRecord,
} from "@/lib/atpocket";
import { computeAuditChanges } from "@/lib/audit-log-changes";
import { auditLogEnabled, recordAuditLog } from "@/lib/audit-log";
import {
  contractNotificationExtraFieldIdList,
  notifyContractCompleted,
  readContractNotificationExtraValues,
  resolveContractNotificationExtraFieldIds,
} from "@/lib/contract-notification-server";
import { todayJstDayKey } from "@/lib/customer-cancel-plan";
import {
  applyCustomerCancelToPayload,
  runCustomerCancelSideEffects,
} from "@/lib/customer-cancel-server";
import { isCustomerStatusCancelledExact } from "@/lib/customer-status-label";
import {
  applyDropboxFolderRenameToPayload,
  resolveCustomerInfoDropboxLinkFieldId,
} from "@/lib/customer-info-dropbox-link";
import { documentUploadMaxBytes } from "@/lib/customer-document-upload";
import { dropboxConfigured } from "@/lib/dropbox";
import { invalidateCustomerInfoKeyLookupCache } from "@/lib/customer-info-key-lookup-cache";
import { invalidateCustomerInfoPendingCache } from "@/lib/customer-info-pending-cache";
import {
  pocketFieldUniqueIdByCaption,
  resolveConfiguredFieldToSchemaUniqueId,
} from "@/lib/calendar-kojo";
import {
  customerInfoConstructionLinkOnSaveEnabled,
  linkCustomerInfoToConstruction,
  type CustomerInfoConstructionLinkResult,
} from "@/lib/customer-info-construction-link";
import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";
import { resolveCustomerInfoConstructionHandlerFieldId } from "@/lib/customer-info-construction-handler";
import { stripCustomerInfoConstructionFieldsFromPayload } from "@/lib/customer-info-construction-locked-fields";
import { resolveCustomerInfoCreatorFieldId } from "@/lib/customer-info-creator-field";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { enrichCustomerInfoFormFieldsWithManufacturers } from "@/lib/trading-partner-manufacturers";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ recordId: string }> };

/** 監査ログの「対象T番」に入れる値（取れなければ空文字） */
function readTargetTNumber(
  recObj: Record<string, unknown> | null,
  appFields: Awaited<ReturnType<typeof fetchAppFields>>,
): string {
  if (!recObj) return "";
  const tNumberId = appFields.find(
    (f) => f.caption?.trim() === "T番号",
  )?.uniqueId;
  if (!tNumberId) return "";
  return readCustomerInfoFieldValue(recObj, tNumberId);
}

/**
 * 保存前の値を @pocket から読む。
 *
 * AP所属支店・CL所属支店は画面に出ない列で、担当者名から名簿を引いて
 * 自動で入れている。担当者が変わっていないなら引き直す必要が無いので、
 * その判定材料としてだけ使う。取得できなければ null を返し、呼び出し側は
 * 従来どおり引き直す（引けなければ書かないので値は潰れない）。
 *
 * 契約速報（タスクR）も「保存前の入力ステータス」と、フォームに出ない
 * T番号・蓄電池設置箇所を必要とする。読む対象が同じレコードなので、
 * 取得回数を増やさずにこの1回へ相乗りさせ、レコードそのものも返す。
 */
async function readCustomerInfoPreSaveSnapshot(
  appId: string,
  recordId: string,
  pocketAuth: AtPocketFetchAuth,
  resolved: Awaited<ReturnType<typeof resolveCustomerInfoFormFields>>["resolved"],
  extraFieldIds: string[] = [],
): Promise<
  | {
      apStaff?: string;
      clStaff?: string;
      /** 読み取れたレコード本体（契約速報が使う） */
      record: Record<string, unknown>;
    }
  | null
> {
  const apFieldId = resolved.find((f) => f.key === "apStaff")?.fieldId;
  const clFieldId = resolved.find((f) => f.key === "clStaff")?.fieldId;
  if (!apFieldId && !clFieldId) return null;

  try {
    const csv = [...new Set([apFieldId, clFieldId, ...extraFieldIds])]
      .filter(Boolean)
      .join(",");
    let row = await fetchRecordById(appId, recordId, pocketAuth, csv);
    if (!row?.record) {
      row = await fetchRecordById(appId, recordId, pocketAuth);
    }
    const rec = row?.record;
    if (!rec || typeof rec !== "object") return null;
    const recObj = rec as Record<string, unknown>;
    return {
      apStaff: apFieldId ? readCustomerInfoFieldValue(recObj, apFieldId) : undefined,
      clStaff: clFieldId ? readCustomerInfoFieldValue(recObj, clFieldId) : undefined,
      record: recObj,
    };
  } catch (e) {
    console.warn(
      "[api/customer-info/records/[recordId]] AP/CL担当者の取得に失敗（所属支店は従来どおり引き直す）",
      e,
    );
    return null;
  }
}

/** お客様情報アプリの住宅ステータス列。連携（sync 側）と同じ解決順にする */
function resolveCustomerInfoHousingStatusFieldId(
  appFields: AtPocketFieldRow[],
): string {
  const fromEnv = process.env.CUSTOMER_INFO_HOUSING_STATUS_FIELD_ID?.trim();
  if (fromEnv) {
    return resolveConfiguredFieldToSchemaUniqueId(fromEnv, appFields) ?? "";
  }
  return (
    pocketFieldUniqueIdByCaption(appFields, "住宅ステータス") ||
    pocketFieldUniqueIdByCaption(appFields, "住宅 ステータス") ||
    ""
  );
}

/**
 * 施工予定日が新しく入った／変わったときだけ工事登録アプリへ載せる（第2段階）。
 *
 * 触らない条件をここに集める。
 *   - 施工予定日が空（空に戻す更新は工事側へ反映しない）
 *   - 保存前と同じ値（何度保存しても照合を走らせない）
 *   - 保存前を読めていない（判定できないときは触らない）
 *   - キャンセル処理が動いた保存（あちらが工事側を持つ）
 */
async function linkConstructionIfScheduledDateEntered(input: {
  values: CustomerInfoFormValues;
  beforeConstructionDate: string | null;
  loadedRecord: Record<string, unknown> | null;
  customerNameFieldId: string;
  housingStatusFieldId: string;
  constructionHandlerFieldId: string;
  tNumber: string;
  lineUserId: string;
  cancelTriggered: boolean;
}): Promise<CustomerInfoConstructionLinkResult | null> {
  if (input.cancelTriggered) return null;

  const after = (input.values.constructionDate ?? "").trim();
  if (!after) return null;
  if (input.beforeConstructionDate === null) return null;
  if (input.beforeConstructionDate.trim() === after) return null;

  const read = (fieldId: string): string =>
    fieldId && input.loadedRecord
      ? readCustomerInfoFieldValue(input.loadedRecord, fieldId)
      : "";

  return linkCustomerInfoToConstruction({
    tNumber: input.tNumber,
    // お客様名はフォームに出ないので、保存する値→保存前の値の順に見る
    customerName:
      (input.values.customerName ?? "").trim() ||
      read(input.customerNameFieldId),
    housingStatus: read(input.housingStatusFieldId),
    constructionDate: after,
    contractor: (input.values.constructionContractor ?? "").trim(),
    // フォームに無い列なので保存前の値をそのまま転記する
    constructionHandler: read(input.constructionHandlerFieldId),
    lineUserId: input.lineUserId,
  });
}

/**
 * 工事アプリで採番された Aki番号 をお客様情報へ書き戻す。
 *
 * ベストエフォート。ここが落ちても工事レコードは出来ているので、
 * 画面には出さずログだけ残す（次に施工予定日を変えれば入り直る）
 */
async function writeAkiNumberBackToCustomerInfo(input: {
  appId: string;
  recordId: string;
  writeAuth: AtPocketFetchAuth;
  appFields: AtPocketFieldRow[];
  akiNumber: string;
  tNumber: string;
}): Promise<void> {
  const akiEnv = process.env.CUSTOMER_INFO_AKI_NUMBER_FIELD_ID?.trim();
  const akiFieldId = akiEnv
    ? resolveConfiguredFieldToSchemaUniqueId(akiEnv, input.appFields)
    : pocketFieldUniqueIdByCaption(input.appFields, "Aki番号");
  if (!akiFieldId) {
    console.error(
      "[api/customer-info] お客様情報の Aki番号 列を解決できません。CUSTOMER_INFO_AKI_NUMBER_FIELD_ID を確認してください",
    );
    return;
  }

  try {
    await updateRecord(
      input.appId,
      input.recordId,
      {
        [akiFieldId]: customerInfoPutValue(input.akiNumber),
        // 取込キー（T番号）の同送が要る
        ...(input.tNumber
          ? { [customerInfoImportKeySchemaId(input.appFields)]:
              customerInfoPutValue(input.tNumber) }
          : {}),
      },
      input.writeAuth,
    );
    invalidateCustomerInfoKeyLookupCache();
  } catch (e) {
    console.error(
      "[api/customer-info] Aki番号 の書き戻しに失敗しました",
      e instanceof Error ? e.message : String(e),
    );
  }
}

/** 取込キー（T番号）の列。解決できなければ空文字キーになるので呼び出し側で守る */
function customerInfoImportKeySchemaId(appFields: AtPocketFieldRow[]): string {
  const env = customerInfoImportKeyFieldId();
  if (!env) return "";
  return resolveConfiguredFieldToSchemaUniqueId(env, appFields) ?? "";
}

async function attachImportKeyAndUpdate(
  appId: string,
  recordId: string,
  pocketAuth: AtPocketFetchAuth,
  appFields: Awaited<ReturnType<typeof fetchAppFields>>,
  payload: Record<string, unknown>,
  lineUserId: string,
): Promise<NextResponse | null> {
  const keyResult = await attachCustomerInfoImportKeyToPayload(
    appId,
    recordId,
    pocketAuth,
    appFields,
    payload,
  );
  if (!keyResult.ok) {
    return NextResponse.json(
      { error: keyResult.error },
      { status: keyResult.status },
    );
  }
  const normalized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    normalized[k] = customerInfoPutValue(v);
  }

  // 更新前の値は監査ログと Dropbox のフォルダ名追随（E-4）の両方が必要とする。
  // 取得に失敗しても保存は続行する（B-1-3 案 b）
  let before: Record<string, unknown> | null = null;
  if (auditLogEnabled() || dropboxConfigured()) {
    try {
      const row = await fetchRecordById(appId, recordId, pocketAuth);
      if (row?.record && typeof row.record === "object") {
        before = row.record as Record<string, unknown>;
      }
    } catch (e) {
      console.warn(
        "[api/customer-info/records/[recordId]] 監査ログ用の更新前レコード取得に失敗",
        e,
      );
    }
  }

  const labelOf = (fieldId: string) =>
    fieldCaptionByUniqueId(appFields, fieldId);
  const targetTNumber = readTargetTNumber(before, appFields);

  // E-4: 顧客名が変わっていたら Dropbox フォルダをリネームし、新しいリンクを
  // この payload に載せる。差分は監査ログ用の計算をそのまま渡して使い回す。
  // 失敗しても顧客情報の更新は止めない（ヘルパ側で例外を握る）。
  await applyDropboxFolderRenameToPayload({
    changes: computeAuditChanges(before, normalized, { labelOf }),
    payload: normalized,
    appFields,
    tNumber: targetTNumber,
    scope: "api/customer-info/records/[recordId] PUT",
  });

  await updateRecord(appId, recordId, normalized, pocketAuth);

  // 記録に失敗しても保存は確定済み。戻り値は見ない（A-5 ベストエフォート）
  // Dropboxリンク列が更新されていれば、ここで通常の列変更として記録される。
  await recordAuditLog({
    lineUserId,
    operation: "update",
    targetAppId: appId,
    targetRecordId: recordId,
    targetTNumber,
    changes: computeAuditChanges(before, normalized, { labelOf }),
  });

  return null;
}

export async function GET(request: Request, ctx: RouteCtx) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const cfg = customerInfoConfigReady();
  if (!cfg.ok) {
    return NextResponse.json(
      { error: cfg.error, disabled: true },
      { status: 503 },
    );
  }

  const { recordId: recordIdRaw } = await ctx.params;
  const recordId = recordIdRaw?.trim();
  if (!recordId) {
    return NextResponse.json({ error: "recordId が必要です" }, { status: 400 });
  }

  const pocketAuth = customerInfoPocketAuth();

  try {
    const fields = await fetchAppFields(cfg.appId, pocketAuth, {
      operation: "customer-info:レコード取得(列定義)",
      appEnv: "CUSTOMER_INFO_APP_ID",
    });
    const nameSchema = resolveConfiguredFieldToSchemaUniqueId(
      cfg.nameFieldId,
      fields,
    );
    if (!nameSchema) {
      return NextResponse.json(
        {
          error: `お客様名フィールド「${cfg.nameFieldId}」がアプリ定義と一致しません`,
        },
        { status: 500 },
      );
    }

    const subtitleEnv = customerInfoSubtitleFieldId();
    const subtitleSchema = subtitleEnv
      ? resolveConfiguredFieldToSchemaUniqueId(subtitleEnv, fields)
      : null;

    const inputStatusSchema = resolveCustomerInfoFormFieldId(
      "inputStatus",
      "入力ステータス",
      fields,
    );

    const creatorSchema = resolveCustomerInfoCreatorFieldId(fields);

    const displayIds = [
      nameSchema,
      ...(inputStatusSchema ? [inputStatusSchema] : []),
      ...(creatorSchema ? [creatorSchema] : []),
      ...(subtitleSchema ? [subtitleSchema] : []),
    ];
    const displayCsv = displayIds.join(",");

    if (!customerInfoUsesLegacyEditableList()) {
      const { resolved, missingCaptions } = resolveCustomerInfoFormFields(fields);
      const transferResolve = resolveCustomerInfoPtTransferFields(fields);
      const allMissing = [
        ...missingCaptions,
        ...transferResolve.missingCaptions,
      ];
      if (resolved.length === 0) {
        return NextResponse.json(
          {
            error:
              "お客様情報フォームの列が @pocket と一致しません。列見出し（お客様名・PT 等）を確認するか、CUSTOMER_INFO_FIELD_* で uniqueId を指定してください。",
            missingCaptions,
          },
          { status: 500 },
        );
      }

      const row = await fetchRecordById(cfg.appId, recordId, pocketAuth);
      if (!row?.record || typeof row.record !== "object") {
        return NextResponse.json(
          { error: "レコードが見つかりません" },
          { status: 404 },
        );
      }
      const recObj = row.record as Record<string, unknown>;
      const values = readCustomerInfoFormValuesFromRecord(
        recObj,
        resolved,
        transferResolve.resolved,
      );
      const formFieldsBase = resolved
        .filter((f) => !f.hiddenInForm)
        .map((f) => ({
          key: f.key,
          fieldId: f.fieldId,
          label: f.label,
          type: f.type,
          options: f.options ? [...f.options] : undefined,
          optionsPending: f.optionsPending,
          liffOnly: f.liffOnly === true,
          required: f.required,
          value: values[f.key] ?? "",
        }));
      const formFields = await enrichCustomerInfoFormFieldsWithManufacturers(
        formFieldsBase,
        values.manufacturer,
      );

      const display = displayIds.map((schemaId) => ({
        fieldId: schemaId,
        label: fieldCaptionByUniqueId(fields, schemaId),
        value: readCustomerInfoFieldValue(recObj, schemaId),
      }));

      // 書類アップロード欄の出し分け（タスクF-6）。
      // Dropboxリンクが空の顧客は書類移行が済んでいないため欄を出さない。
      // API 側でも 400 で防いでおり、ここは表示制御のためだけの情報。
      const dropboxLinkFieldId =
        resolveCustomerInfoDropboxLinkFieldId(fields);
      const dropboxFolderConfigured = Boolean(
        dropboxConfigured() &&
          dropboxLinkFieldId &&
          readCustomerInfoFieldValue(recObj, dropboxLinkFieldId).trim(),
      );

      return NextResponse.json({
        recordId,
        usesFormSchema: true,
        display,
        formFields,
        formValues: values,
        missingCaptions: allMissing.length > 0 ? allMissing : undefined,
        dropboxFolderConfigured,
        documentUploadMaxBytes: documentUploadMaxBytes(),
      });
    }

    const editableResolved = resolveCustomerInfoFieldIds(
      customerInfoEditableFieldIds(),
      fields,
    );
    const schemaIds = [
      ...displayIds,
      ...editableResolved.map((f) => f.schemaId),
    ];
    const fieldsCsv = [...new Set(schemaIds)].join(",");

    let row = await fetchRecordById(
      cfg.appId,
      recordId,
      pocketAuth,
      fieldsCsv,
    );
    if (!row?.record) {
      row = await fetchRecordById(cfg.appId, recordId, pocketAuth);
    }
    if (!row?.record || typeof row.record !== "object") {
      return NextResponse.json(
        { error: "レコードが見つかりません" },
        { status: 404 },
      );
    }

    const recObj = row.record as Record<string, unknown>;
    const display = displayIds.map((schemaId) => ({
      fieldId: schemaId,
      label: fieldCaptionByUniqueId(fields, schemaId),
      value: readCustomerInfoFieldValue(recObj, schemaId),
    }));
    const editableFields = editableResolved.map((f) => ({
      fieldId: f.schemaId,
      label: f.caption,
      value: readCustomerInfoFieldValue(recObj, f.schemaId),
    }));

    return NextResponse.json({
      recordId,
      usesFormSchema: false,
      display,
      editableFields,
      editableFieldIdsConfigured: editableResolved.length > 0,
    });
  } catch (e) {
    return pocketErrorResponse(e, {
      scope: "api/customer-info/records/[recordId] GET",
      message: "レコードの取得に失敗しました",
    });
  }
}

export async function PUT(request: Request, ctx: RouteCtx) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const cfg = customerInfoConfigReady();
  if (!cfg.ok) {
    return NextResponse.json(
      { error: cfg.error, disabled: true },
      { status: 503 },
    );
  }

  const { recordId: recordIdRaw } = await ctx.params;
  const recordId = recordIdRaw?.trim();
  if (!recordId) {
    return NextResponse.json({ error: "recordId が必要です" }, { status: 400 });
  }

  let body: {
    fields?: Record<string, unknown>;
    formValues?: Record<string, unknown>;
  };
  try {
    body = (await request.json()) as {
      fields?: Record<string, unknown>;
      formValues?: Record<string, unknown>;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const incoming =
    body.formValues && typeof body.formValues === "object"
      ? body.formValues
      : body.fields;
  if (!incoming || typeof incoming !== "object") {
    return NextResponse.json(
      { error: "formValues または fields オブジェクトが必要です" },
      { status: 400 },
    );
  }

  const readAuth = customerInfoPocketAuth1();
  const writeAuth = customerInfoPocketAuthWrite();

  try {
    const appFields = await fetchAppFields(cfg.appId, readAuth, {
      operation: "customer-info:レコード保存(列定義)",
      appEnv: "CUSTOMER_INFO_APP_ID",
    });

    if (!customerInfoUsesLegacyEditableList()) {
      const { resolved } = resolveCustomerInfoFormFields(appFields);
      if (resolved.length === 0) {
        return NextResponse.json(
          { error: "お客様情報フォームの列定義を解決できません" },
          { status: 503 },
        );
      }

      const parsed = formValuesFromPutBody(
        incoming as Record<string, unknown>,
        resolved,
      );
      if (!parsed) {
        return NextResponse.json(
          { error: "フォームの項目キーが認識できません" },
          { status: 400 },
        );
      }
      const values = syncCombinedNameFields(expandNamePartsInValues(parsed));

      /**
       * V-5: キャンセルにするときだけ必須チェックを通す。
       * クライアントの申告（フラグ）ではなく、**これから保存する
       * 顧客ステータスの値そのもの**をサーバで見て判断する。
       */
      const savingCancelled = isCustomerStatusCancelledExact(
        values.customerStatus,
      );

      const missingRequired = findMissingRequiredCustomerInfoFields(
        resolved
          .filter((f) => !f.hiddenInForm)
          .map((f) => ({
            key: f.key,
            label: f.label,
            type: f.type,
            required: f.required,
          })),
        values,
        { treatAllRequiredAsOptional: savingCancelled },
      );
      if (missingRequired.length > 0) {
        return NextResponse.json(
          {
            error: formatCustomerInfoRequiredValidationError(missingRequired),
          },
          { status: 400 },
        );
      }

      // 契約速報（タスクR）が使う列。フォームに無いので別に解決する
      const notificationFieldIds =
        resolveContractNotificationExtraFieldIds(appFields);
      const inputStatusFieldId =
        resolved.find((f) => f.key === "inputStatus")?.fieldId ?? "";
      // キャンセル処理（タスクV）のトリガー判定に使う保存前の顧客ステータス
      const customerStatusFieldId =
        resolved.find((f) => f.key === "customerStatus")?.fieldId ?? "";

      /**
       * 第2段階: 施工予定日を入れたら工事登録アプリへ載せる。
       *
       * ⚠ **既定では動かない。** 施工予定日の割り当ては工事カレンダーから
       *    行う方針に変わったため、お客様情報の保存からは連携しない。
       *    処理は第3段階で一部を再利用する見込みがあるので残してある。
       *
       * 連携する材料（保存前の施工予定日・お客様名・住宅ステータス・
       * 工事対応者）は下の保存前レコードから読む。連携しないなら列を
       * 増やさない — @pocket から運ぶ量をそのぶん減らす
       */
      const constructionLinkEnabled =
        customerInfoConstructionLinkOnSaveEnabled();
      const constructionDateFieldId = constructionLinkEnabled
        ? (resolved.find((f) => f.key === "constructionDate")?.fieldId ?? "")
        : "";
      const customerNameFieldId = constructionLinkEnabled
        ? (resolved.find((f) => f.key === "customerName")?.fieldId ?? "")
        : "";
      const housingStatusFieldId = constructionLinkEnabled
        ? resolveCustomerInfoHousingStatusFieldId(appFields)
        : "";
      /**
       * 工事対応者はお客様情報のフォームに無い列。
       * 工事アプリへ転記するので保存前レコードから読む
       * （update-construction-handler が両アプリへ同じ名前を書いている）
       */
      const constructionHandlerFieldId = constructionLinkEnabled
        ? (resolveCustomerInfoConstructionHandlerFieldId(appFields) ?? "")
        : "";

      // AP/CL所属支店を引き直すかの判定に使う。担当者が変わっていなければ
      // 支店は触らない（引けないときに "-" で潰さないため）。
      // 取得に失敗しても保存は続ける（従来どおり引き直す動きに戻るだけ）
      const loadedStaff = await readCustomerInfoPreSaveSnapshot(
        cfg.appId,
        recordId,
        readAuth,
        resolved,
        [
          ...(inputStatusFieldId ? [inputStatusFieldId] : []),
          ...(customerStatusFieldId ? [customerStatusFieldId] : []),
          ...(constructionDateFieldId ? [constructionDateFieldId] : []),
          ...(customerNameFieldId ? [customerNameFieldId] : []),
          ...(housingStatusFieldId ? [housingStatusFieldId] : []),
          ...(constructionHandlerFieldId ? [constructionHandlerFieldId] : []),
          ...contractNotificationExtraFieldIdList(notificationFieldIds),
        ],
      );

      // 保存前の入力ステータス。読めていなければ null＝契約速報は送らない
      const beforeInputStatus =
        loadedStaff && inputStatusFieldId
          ? readCustomerInfoFieldValue(loadedStaff.record, inputStatusFieldId)
          : null;
      const notificationExtras = readContractNotificationExtraValues(
        loadedStaff?.record ?? null,
        notificationFieldIds,
      );

      // V-1: 「キャンセル以外 → キャンセル」に変わったときだけ実行する。
      // 保存前の値を読めていなければ実行しない（元に戻せない処理なので、
      // 判定できないときは動かさない側に倒す）
      const beforeCustomerStatus =
        loadedStaff && customerStatusFieldId
          ? readCustomerInfoFieldValue(loadedStaff.record, customerStatusFieldId)
          : null;
      const cancelTriggered =
        savingCancelled &&
        beforeCustomerStatus !== null &&
        !isCustomerStatusCancelledExact(beforeCustomerStatus);

      // 空き枠の判定は**消す前**の施工予定日・施工会社で行う。
      // 画面の確認ダイアログが見ている値と同じものを使う
      const cancelSource = cancelTriggered
        ? {
            constructionDate: values.constructionDate ?? "",
            contractor: values.constructionContractor ?? "",
          }
        : null;

      if (cancelTriggered) {
        // V-2: PT を 0 にし、4項目のうちフォームにある3項目を空にする。
        // 工事対応者はフォーム外の列なので payload 側で消す
        values.pt = "0";
        values.constructionDate = "";
        values.firstConstructionDate = "";
        values.constructionContractor = "";
      }

      const payload = await formPayloadFromValues(
        values,
        resolved,
        appFields,
        writeAuth,
        loadedStaff,
      );
      if (cancelTriggered) {
        applyCustomerCancelToPayload(payload, appFields);
      } else {
        /**
         * 施工予定日・施工業者は画面から変更できない（表示だけ）。
         * 入力欄を消しても API を直に叩けば書けるので、ここでも落とす。
         *
         * キャンセルのときは通す。あちらはこの2項目を**空にするのが仕事**で、
         * 落とすと施工予定日が残ったままキャンセルになってしまう。
         * 工事カレンダーからの連携は自前で payload を組み立てて
         * updateRecord を呼ぶので、そもそもここを通らない
         */
        const dropped = stripCustomerInfoConstructionFieldsFromPayload(
          payload,
          (key) => resolved.find((f) => f.key === key)?.fieldId ?? null,
        );
        if (dropped.length > 0) {
          console.warn(
            "[api/customer-info/records/[recordId] PUT] 工事カレンダー側で管理する項目を保存対象から外しました",
            { dropped },
          );
        }
      }
      if (Object.keys(payload).length === 0) {
        return NextResponse.json(
          { error: "更新する項目がありません" },
          { status: 400 },
        );
      }

      const keyErr = await attachImportKeyAndUpdate(
        cfg.appId,
        recordId,
        writeAuth,
        appFields,
        payload,
        auth.lineUserId,
      );
      if (keyErr) return keyErr;

      // 未入力一覧・T番号キー検索のキャッシュは、legacy 分岐だけでなく
      // こちらでも捨てる。入力ステータスや T番号が変わったのに一覧が
      // 古いままだと、保存したはずの案件が未入力に残り続ける
      invalidateCustomerInfoPendingCache();
      invalidateCustomerInfoKeyLookupCache();

      // V-7: お客様情報の更新が成功してから、工事登録アプリの更新と
      // 空き枠の作成を行う。ここで失敗しても保存は成功のまま warning を返す
      const warnings: string[] = [];
      let cancelResult: Awaited<
        ReturnType<typeof runCustomerCancelSideEffects>
      > | null = null;
      if (cancelTriggered && cancelSource) {
        try {
          cancelResult = await runCustomerCancelSideEffects({
            tNumber: notificationExtras.tNumber,
            constructionDate: cancelSource.constructionDate,
            contractor: cancelSource.contractor,
            todayDayKey: todayJstDayKey(),
            lineUserId: auth.lineUserId,
          });
          warnings.push(...cancelResult.warnings);
        } catch (e) {
          // ここで投げるとお客様情報の更新が済んでいるのにエラー応答になる
          console.error("[api/customer-info] キャンセル処理の後段で例外", e);
          warnings.push(
            "キャンセル処理は完了しましたが、工事登録アプリの更新に失敗しました。DX事業部へ連絡してください。",
          );
        }
      }

      /**
       * 第2段階: 施工予定日が**新しく入った／変わった**ときだけ、
       * 工事登録アプリへ載せる。
       *
       * ⚠ 既定では constructionLinkEnabled が false なので通らない。
       *
       * 毎回確認すると保存のたびに @pocket の照合が走る。
       * 保存前の値と比べて変わったときだけにする。
       * 保存前を読めていないときは動かさない（キャンセル処理と同じ考え方で、
       * 判定できないときは触らない側に倒す）。
       * 空に戻す更新は工事側へ反映しない（レコードも消さない）
       */
      const beforeConstructionDate =
        loadedStaff && constructionDateFieldId
          ? readCustomerInfoFieldValue(loadedStaff.record, constructionDateFieldId)
          : null;
      const linkResult = constructionLinkEnabled
        ? await linkConstructionIfScheduledDateEntered({
            values,
            beforeConstructionDate,
            loadedRecord: loadedStaff?.record ?? null,
            customerNameFieldId,
            housingStatusFieldId,
            constructionHandlerFieldId,
            tNumber: notificationExtras.tNumber,
            lineUserId: auth.lineUserId,
            cancelTriggered,
          })
        : null;
      if (linkResult?.kind === "failed") warnings.push(linkResult.warning);

      /**
       * 採番された Aki番号 をお客様情報へ書き戻す。
       * 失敗しても工事側のレコードは出来ているので警告にしない
       */
      if (linkResult?.kind === "created" && linkResult.akiNumber) {
        await writeAkiNumberBackToCustomerInfo({
          appId: cfg.appId,
          recordId,
          writeAuth,
          appFields,
          akiNumber: linkResult.akiNumber,
          tNumber: notificationExtras.tNumber,
        });
      }

      // 契約速報（タスクR）は @pocket への保存が済んでから送る。
      // 送信に失敗しても保存は成功のまま、warning だけ画面へ返す
      const notified = await notifyContractCompleted({
        values,
        beforeInputStatus,
        extras: notificationExtras,
      });
      if (notified.kind === "failed") warnings.push(notified.warning);

      return NextResponse.json({
        ok: true,
        ...(warnings.length > 0 ? { warning: warnings.join("\n") } : {}),
        ...(cancelResult
          ? {
              cancelled: {
                constructionUpdated: cancelResult.constructionUpdated,
                emptySlotCreated: cancelResult.emptySlotCreated,
              },
            }
          : {}),
      });
    }

    const editableResolved = resolveCustomerInfoFieldIds(
      customerInfoEditableFieldIds(),
      appFields,
    );
    if (editableResolved.length === 0) {
      return NextResponse.json(
        {
          error:
            "編集可能なフィールドが未設定です。CUSTOMER_INFO_EDITABLE_FIELD_IDS を設定してください。",
        },
        { status: 503 },
      );
    }

    const allowed = new Map(
      editableResolved.map((f) => [f.schemaId, f] as const),
    );
    const patch: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(incoming)) {
      const schemaId = resolveConfiguredFieldToSchemaUniqueId(key, appFields);
      if (!schemaId || !allowed.has(schemaId)) continue;
      patch[schemaId] = customerInfoPutValue(raw);
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        {
          error:
            "更新する項目がありません（許可されたフィールド ID を確認してください）",
        },
        { status: 400 },
      );
    }

    const keyErr = await attachImportKeyAndUpdate(
      cfg.appId,
      recordId,
      writeAuth,
      appFields,
      patch,
      auth.lineUserId,
    );
    if (keyErr) return keyErr;
    invalidateCustomerInfoPendingCache();
    invalidateCustomerInfoKeyLookupCache();
    return NextResponse.json({ ok: true });
  } catch (e) {
    // 設定ミスを運用者へ伝える文言は維持し、@pocket の生メッセージは載せない
    const raw = e instanceof Error ? e.message : "";
    if (raw.includes("T番号") && raw.includes("取込設定")) {
      console.error("[api/customer-info/records/[recordId] PUT]", e);
      return NextResponse.json(
        {
          error:
            "@pocket: 取込キー「T番号」を認識できませんでした。お客様情報アプリの取込設定に「T番号」がキー項目として含まれているか、CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID が管理画面の「T番号」列の識別名（field-1 など）と一致しているか確認してください。",
        },
        { status: 502 },
      );
    }
    if (raw.includes("有効なフィールドではありません")) {
      console.error("[api/customer-info/records/[recordId] PUT]", e);
      return NextResponse.json(
        {
          error:
            "@pocket: 更新できない列が指定されています。管理画面の列識別名と CUSTOMER_INFO_FIELD_* の設定が一致しているか、計算・表示専用列を指定していないか確認してください。",
        },
        { status: 502 },
      );
    }
    return pocketErrorResponse(e, {
      scope: "api/customer-info/records/[recordId] PUT",
      message: "更新に失敗しました",
    });
  }
}
