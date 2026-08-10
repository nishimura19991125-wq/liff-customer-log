import { NextResponse } from "next/server";

import { buildCalendarPatchAfterConstructionSave } from "@/lib/calendar-record-patch-server";
import { recordAuditLog } from "@/lib/audit-log";
import { computeAuditChanges } from "@/lib/audit-log-changes";
import { fieldCaptionByUniqueId } from "@/lib/customer-info-record";
import { invalidateAllCalendarPayloadCache } from "@/lib/calendar-response-cache";
import { getCachedConstructionRecordsBestEffort } from "@/lib/calendar-construction-records-cache";
import { calendarConstructionHandlerFieldIdFromEnv } from "@/lib/calendar-construction-handler-env";
import { resolveConstructionHandlerWriteValue } from "@/lib/calendar-construction-handler-select";
import { formatConstructionCreateRecordError } from "@/lib/calendar-construction-create-error";
import {
  fetchConstructionRecordRow,
  readConstructionTNumberFromRecord,
  uniqueFieldsCsv,
} from "@/lib/calendar-construction-pocket-common";
import {
  resolveConfiguredFieldToSchemaUniqueId,
  resolveConstructionTNumberFieldId,
} from "@/lib/calendar-kojo";
import {
  apiKeyForCalendarPocket,
  apiKeyForCalendarPocket1,
  apiKeyForCalendarWrite,
  fetchAppFields,
  isPocketHttpRateLimitError,
  updateRecord,
} from "@/lib/atpocket";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import {
  constructionHandlerStaffConfigReady,
  resolveConstructionHandlerNameForActiveStaff,
} from "@/lib/staff-construction-handler-candidates";

export const dynamic = "force-dynamic";

type Body = {
  recordId?: string;
  constructionHandlerStaffRecordId?: string;
  constructionRegistrantStaffRecordId?: string;
  viewYear?: number;
  viewMonth?: number;
};

export async function POST(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const calAppId = process.env.CALENDAR_APP_ID?.trim();
  if (!calAppId) {
    return NextResponse.json(
      { error: "CALENDAR_APP_ID が未設定です", disabled: true },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const recordId = body.recordId?.trim() ?? "";
  const constructionHandlerStaffRecordId =
    body.constructionHandlerStaffRecordId?.trim() ||
    body.constructionRegistrantStaffRecordId?.trim() ||
    "";

  if (!recordId) {
    return NextResponse.json({ error: "recordId が必要です" }, { status: 400 });
  }
  if (!constructionHandlerStaffRecordId) {
    return NextResponse.json(
      { error: "工事対応者を選択してください" },
      { status: 400 },
    );
  }

  const handlerFieldEnv = calendarConstructionHandlerFieldIdFromEnv();
  if (!handlerFieldEnv) {
    return NextResponse.json(
      {
        error:
          "工事対応者フィールドが未設定です。CALENDAR_EMPTY_FILL_CONSTRUCTION_HANDLER_FIELD_ID を設定してください。",
      },
      { status: 503 },
    );
  }

  if (!constructionHandlerStaffConfigReady()) {
    return NextResponse.json(
      {
        error:
          "工事対応者はスタッフ名簿と連携する必要があります。STAFF_APP_ID・STAFF_NAME_FIELD_ID・STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID を設定してください。",
      },
      { status: 503 },
    );
  }

  try {
    const readAuth = { apiKey: apiKeyForCalendarPocket1() };
    const constructionFields = await fetchAppFields(calAppId, readAuth);
    const resolvedHandlerField = resolveConfiguredFieldToSchemaUniqueId(
      handlerFieldEnv,
      constructionFields,
    );
    if (!resolvedHandlerField) {
      return NextResponse.json(
        {
          error: `工事対応者フィールド「${handlerFieldEnv}」が工事アプリのフィールド定義と一致しません。`,
        },
        { status: 503 },
      );
    }

    const resolvedTNumber =
      resolveConstructionTNumberFieldId(constructionFields);
    if (!resolvedTNumber) {
      return NextResponse.json(
        {
          error:
            "T番号フィールドの uniqueId が分かりません。CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID を .env に設定するか、アプリに「T番号」見出しのフィールドを用意してください。",
        },
        { status: 500 },
      );
    }

    const resolvedName = await resolveConstructionHandlerNameForActiveStaff(
      constructionHandlerStaffRecordId,
    );
    if (!resolvedName.ok) {
      const msg =
        resolvedName.reason === "not_found"
          ? "選択した社員が見つかりません。"
          : resolvedName.reason === "not_active"
            ? "選択した社員は工事対応が「稼働」ではありません。一覧を更新して選び直してください。"
            : resolvedName.reason === "no_name"
              ? "スタッフ名簿に氏名が入っていません。"
              : "工事対応者を検証できませんでした。";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const fieldsCsv = uniqueFieldsCsv(resolvedHandlerField, resolvedTNumber);
    const recRow = await fetchConstructionRecordRow(
      calAppId,
      recordId,
      readAuth,
      fieldsCsv,
    );
    if (!recRow?.record || typeof recRow.record !== "object") {
      return NextResponse.json(
        { error: "レコードが見つかりません" },
        { status: 404 },
      );
    }

    const existingT = readConstructionTNumberFromRecord(
      recRow.record as Record<string, unknown>,
      resolvedTNumber,
    );
    if (!existingT) {
      return NextResponse.json(
        {
          error:
            "このレコードから T番号 を取得できませんでした。@pocket で T番号 が入っているか、フィールド設定を確認してください。",
        },
        { status: 409 },
      );
    }

    const cachedRows = getCachedConstructionRecordsBestEffort();
    const sampleRows = cachedRows.length > 0 ? cachedRows : [recRow];
    const writeResolved = resolveConstructionHandlerWriteValue({
      staffName: resolvedName.name,
      handlerFieldId: resolvedHandlerField,
      constructionFields,
      sampleRows,
    });
    if (!writeResolved.ok) {
      return NextResponse.json(
        {
          error:
            writeResolved.reason === "not_in_options"
              ? `「${resolvedName.name}」は @pocket 工事アプリの工事対応者選択肢にありません。選択肢に氏名を追加してから再度お試しください。`
              : "工事対応者を書き込めませんでした。",
        },
        { status: 400 },
      );
    }

    const writeAuth = { apiKey: apiKeyForCalendarWrite() };
    const handlerPatch = {
      [resolvedTNumber]: existingT,
      [resolvedHandlerField]: writeResolved.writeValue,
    };
    await updateRecord(calAppId, recordId, handlerPatch, writeAuth);

    // 工事対応者の差し替え（ベストエフォート。更新は確定済み）
    await recordAuditLog({
      lineUserId: auth.lineUserId,
      operation: "update",
      targetAppId: calAppId,
      targetRecordId: recordId,
      targetTNumber: existingT,
      changes: computeAuditChanges(
        recRow.record as Record<string, unknown>,
        handlerPatch,
        {
          labelOf: (fieldId) =>
            fieldCaptionByUniqueId(constructionFields, fieldId),
        },
      ),
    });

    invalidateAllCalendarPayloadCache();

    // 保存自体は完了済み。画面差分の再取得が 429 でも成功扱いにする
    let calendarPatch = null;
    try {
      calendarPatch = await buildCalendarPatchAfterConstructionSave(
        calAppId,
        recordId,
        { apiKey: apiKeyForCalendarPocket() },
        body.viewYear,
        body.viewMonth,
        { constructionFields },
      );
    } catch (patchErr) {
      if (!isPocketHttpRateLimitError(patchErr)) throw patchErr;
      console.warn(
        "[api/calendar/update-construction-handler] calendar patch skipped after 429",
      );
    }

    return NextResponse.json({
      ok: true,
      constructionHandlerName: writeResolved.displayName,
      calendarPatch,
      ...(calendarPatch
        ? {}
        : {
            calendarPatchSkipped: true,
            rosterMessage:
              "工事対応者は更新しました。カレンダー表示の再読込はしばらくお待ちください。",
          }),
    });
  } catch (e) {
    console.error("[api/calendar/update-construction-handler]", e);
    if (isPocketHttpRateLimitError(e)) {
      return NextResponse.json(
        {
          error:
            "いま @pocket のリクエスト上限に達しています。100秒ほど待ってからもう一度保存してください。",
          rateLimited: true,
        },
        { status: 429, headers: { "Retry-After": "100" } },
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error:
          formatConstructionCreateRecordError(msg) ||
          "工事対応者の更新に失敗しました",
      },
      { status: 502 },
    );
  }
}
