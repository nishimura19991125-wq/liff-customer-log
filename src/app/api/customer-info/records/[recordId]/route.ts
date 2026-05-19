import { NextResponse } from "next/server";

import {
  customerInfoConfigReady,
  customerInfoEditableFieldIds,
  customerInfoPocketAuth,
  customerInfoSubtitleFieldId,
  customerInfoUsesLegacyEditableList,
} from "@/lib/customer-info-config";
import { attachCustomerInfoImportKeyToPayload } from "@/lib/customer-info-form/put-payload";
import { formPayloadFromValues } from "@/lib/customer-info-form/put-payload";
import {
  customerInfoFormFieldsCsv,
  formValuesFromPutBody,
  readCustomerInfoFormValuesFromRecord,
  resolveCustomerInfoFormFields,
  resolveCustomerInfoPtTransferFields,
} from "@/lib/customer-info-form/resolve-fields";
import {
  customerInfoPutValue,
  fieldCaptionByUniqueId,
  readCustomerInfoFieldValue,
  resolveCustomerInfoFieldIds,
} from "@/lib/customer-info-record";
import type { AtPocketFetchAuth } from "@/lib/atpocket";
import { fetchAppFields, fetchRecordById, updateRecord } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ recordId: string }> };

async function attachImportKeyAndUpdate(
  appId: string,
  recordId: string,
  pocketAuth: AtPocketFetchAuth,
  appFields: Awaited<ReturnType<typeof fetchAppFields>>,
  payload: Record<string, unknown>,
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
  await updateRecord(appId, recordId, normalized, pocketAuth);
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
    const fields = await fetchAppFields(cfg.appId, pocketAuth);
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

    const displayIds = [nameSchema, ...(subtitleSchema ? [subtitleSchema] : [])];
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

      const fetchCsv = [
        displayCsv,
        customerInfoFormFieldsCsv(resolved),
      ]
        .filter(Boolean)
        .join(",");

      let row = await fetchRecordById(
        cfg.appId,
        recordId,
        pocketAuth,
        fetchCsv,
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
      const values = readCustomerInfoFormValuesFromRecord(
        recObj,
        resolved,
        transferResolve.resolved,
      );
      const formFields = resolved.map((f) => ({
        key: f.key,
        fieldId: f.fieldId,
        label: f.label,
        type: f.type,
        options: f.options ? [...f.options] : undefined,
        optionsPending: f.optionsPending,
        liffOnly: f.liffOnly === true,
        value: values[f.key] ?? "",
      }));

      const display = displayIds.map((schemaId) => ({
        fieldId: schemaId,
        label: fieldCaptionByUniqueId(fields, schemaId),
        value: readCustomerInfoFieldValue(recObj, schemaId),
      }));

      return NextResponse.json({
        recordId,
        usesFormSchema: true,
        display,
        formFields,
        missingCaptions: allMissing.length > 0 ? allMissing : undefined,
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
    console.error("[api/customer-info/records/[recordId] GET]", e);
    return NextResponse.json(
      { error: "レコードの取得に失敗しました" },
      { status: 502 },
    );
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

  const pocketAuth = customerInfoPocketAuth();

  try {
    const appFields = await fetchAppFields(cfg.appId, pocketAuth);

    if (!customerInfoUsesLegacyEditableList()) {
      const { resolved } = resolveCustomerInfoFormFields(appFields);
      if (resolved.length === 0) {
        return NextResponse.json(
          { error: "お客様情報フォームの列定義を解決できません" },
          { status: 503 },
        );
      }

      const values = formValuesFromPutBody(
        incoming as Record<string, unknown>,
        resolved,
      );
      if (!values) {
        return NextResponse.json(
          { error: "フォームの項目キーが認識できません" },
          { status: 400 },
        );
      }

      const payload = formPayloadFromValues(values, resolved, appFields);
      if (Object.keys(payload).length === 0) {
        return NextResponse.json(
          { error: "更新する項目がありません" },
          { status: 400 },
        );
      }

      const keyErr = await attachImportKeyAndUpdate(
        cfg.appId,
        recordId,
        pocketAuth,
        appFields,
        payload,
      );
      if (keyErr) return keyErr;
      return NextResponse.json({ ok: true });
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
      pocketAuth,
      appFields,
      patch,
    );
    if (keyErr) return keyErr;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/customer-info/records/[recordId] PUT]", e);
    let msg = e instanceof Error ? e.message : "更新に失敗しました";
    if (msg.includes("T番号") && msg.includes("取込設定")) {
      msg =
        "@pocket: 取込キー「T番号」を認識できませんでした。お客様情報アプリの取込設定に「T番号」がキー項目として含まれているか、CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID が管理画面の「T番号」列の識別名（field-1 など）と一致しているか確認してください。";
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
