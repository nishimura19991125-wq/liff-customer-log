import { NextResponse } from "next/server";

import {
  customerInfoConfigReady,
  customerInfoEditableFieldIds,
  customerInfoImportKeyFieldId,
  customerInfoImportKeySourceFieldIds,
  customerInfoPocketAuth,
  customerInfoSubtitleFieldId,
} from "@/lib/customer-info-config";
import {
  customerInfoPutValue,
  fieldCaptionByUniqueId,
  readCustomerInfoFieldValue,
  readCustomerInfoImportKeyFromRecord,
  resolveCustomerInfoFieldIds,
} from "@/lib/customer-info-record";
import { fetchAppFields, fetchRecordById, updateRecord } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ recordId: string }> };

function displayFieldIds(
  nameSchemaId: string,
  subtitleSchemaId: string | null,
  editableSchemaIds: string[],
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const push = (id: string) => {
    const t = id.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    ordered.push(t);
  };
  push(nameSchemaId);
  if (subtitleSchemaId) push(subtitleSchemaId);
  for (const id of editableSchemaIds) push(id);
  return ordered;
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

    const editableResolved = resolveCustomerInfoFieldIds(
      customerInfoEditableFieldIds(),
      fields,
    );

    const schemaIds = displayFieldIds(
      nameSchema,
      subtitleSchema,
      editableResolved.map((f) => f.schemaId),
    );
    const fieldsCsv = schemaIds.join(",");

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

    const display = schemaIds.map((schemaId) => ({
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

  let body: { fields?: Record<string, unknown> };
  try {
    body = (await request.json()) as { fields?: Record<string, unknown> };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const incoming = body.fields;
  if (!incoming || typeof incoming !== "object") {
    return NextResponse.json(
      { error: "fields オブジェクトが必要です" },
      { status: 400 },
    );
  }

  const pocketAuth = customerInfoPocketAuth();

  try {
    const appFields = await fetchAppFields(cfg.appId, pocketAuth);
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
        { error: "更新する項目がありません（許可されたフィールド ID を確認してください）" },
        { status: 400 },
      );
    }

    const payload: Record<string, unknown> = { ...patch };

    const importKeyEnv = customerInfoImportKeyFieldId();
    if (importKeyEnv) {
      const importKeySchema = resolveConfiguredFieldToSchemaUniqueId(
        importKeyEnv,
        appFields,
      );
      if (!importKeySchema) {
        return NextResponse.json(
          {
            error: `取込キー（T番号）フィールド「${importKeyEnv}」がアプリ定義と一致しません。CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID を確認してください。`,
          },
          { status: 500 },
        );
      }

      if (!Object.prototype.hasOwnProperty.call(payload, importKeySchema)) {
        const fieldsCsv = [
          importKeySchema,
          ...customerInfoImportKeySourceFieldIds(),
        ].join(",");
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
        const keyValue = readCustomerInfoImportKeyFromRecord(
          recObj,
          importKeySchema,
          customerInfoImportKeySourceFieldIds(),
        );
        if (!keyValue) {
          return NextResponse.json(
            {
              error:
                "このレコードの T番号（取込キー）を取得できませんでした。@pocket に T番号 が入っているか、CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID が「T番号」列の識別名と一致しているか確認してください。",
            },
            { status: 400 },
          );
        }
        payload[importKeySchema] = keyValue;
      }
    }

    // 変更項目 + 取込キーのみ PUT（GET 全体を載せると field-数字 で 400 になる）
    await updateRecord(cfg.appId, recordId, payload, pocketAuth);

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
