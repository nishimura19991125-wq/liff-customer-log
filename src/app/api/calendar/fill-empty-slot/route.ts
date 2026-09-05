import { NextResponse } from "next/server";

import { isValidEmptyFillHousingStatus } from "@/lib/calendar-empty-fill-options";
import {
  buildConstructionFillPatch,
  fetchConstructionRecordRow,
  readConstructionTNumberFromRecord,
  uniqueFieldsCsv,
} from "@/lib/calendar-construction-pocket-common";
import {
  constructionTitleFieldIsEmpty,
  resolveConfiguredFieldToSchemaUniqueId,
  resolveConstructionFieldIds,
  resolveConstructionImportKeyFieldId,
  resolveConstructionTNumberFieldId,
  resolveEmptyFillHousingStatusFieldId,
} from "@/lib/calendar-kojo";
import {
  apiKeyForCalendarPocket1,
  apiKeyForCalendarWrite,
  fetchAppFields,
} from "@/lib/atpocket";
import { writePocketRecordWithImportKey } from "@/lib/atpocket-write-with-import-key";
import { recordAuditLog } from "@/lib/audit-log";
import { computeAuditChanges } from "@/lib/audit-log-changes";
import { fieldCaptionByUniqueId } from "@/lib/customer-info-record";
import { calendarConstructionHandlerFieldIdFromEnv } from "@/lib/calendar-construction-handler-env";
import {
  calendarSlotConflictResponse,
  readFreshConstructionEmptySlotState,
} from "@/lib/calendar-slot-reservation";
import { invalidateAllCalendarPayloadCache } from "@/lib/calendar-response-cache";
import { finalizeConstructionCalendarSave } from "@/lib/calendar-after-construction-save";
import { formatConstructionCreateRecordError } from "@/lib/calendar-construction-create-error";
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
  customerName?: string;
  housingStatus?: string;
  constructionHandlerStaffRecordId?: string;
  /** 後方互換（工事登録者API名） */
  constructionRegistrantStaffRecordId?: string;
  /** 新築案件の任意日程（YYYY-MM-DD）。未送信・空は書き込まない */
  shigumiDate?: string;
  panelWorkDate?: string;
  electricWorkDate?: string;
  appSettingsDayDate?: string;
  /** カレンダー上で選択中の日（YYYY-MM-DD）。同日空枠削除の日付解決に使用 */
  slotDayKey?: string;
  /** 表示中のカレンダー月（即時反映用・任意） */
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

  const customerField =
    process.env.CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID?.trim() ||
    process.env.CALENDAR_EMPTY_FILL_TITLE_FIELD_ID?.trim();

  if (!customerField) {
    return NextResponse.json(
      {
        error:
          "工事空枠の入力先フィールドが未設定です。.env に CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID（@pocket の uniqueId）を設定してください。",
      },
      { status: 500 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const recordId = body.recordId?.trim();
  const customerName = body.customerName?.trim();
  const housingRaw = body.housingStatus?.trim() ?? "";
  const constructionHandlerStaffRecordId =
    body.constructionHandlerStaffRecordId?.trim() ||
    body.constructionRegistrantStaffRecordId?.trim() ||
    "";

  if (!recordId || !customerName || !housingRaw) {
    return NextResponse.json(
      { error: "recordId・お客様名・住宅ステータスはすべて必須です" },
      { status: 400 },
    );
  }

  if (!isValidEmptyFillHousingStatus(housingRaw)) {
    return NextResponse.json(
      {
        error:
          "住宅ステータスは「新築案件」または「既築案件」を指定してください",
      },
      { status: 400 },
    );
  }

  const readAuth = { apiKey: apiKeyForCalendarPocket1() };
  const writeAuth = { apiKey: apiKeyForCalendarWrite() };

  let constructionUpdated = false;

  try {
    const constructionFields = await fetchAppFields(calAppId, readAuth);

    const resolvedCustomer = resolveConfiguredFieldToSchemaUniqueId(
      customerField,
      constructionFields,
    );
    if (!resolvedCustomer) {
      return NextResponse.json(
        {
          error:
            `お客様名フィールド「${customerField}」が工事アプリのフィールド定義と一致しません。GET /api/apps/{アプリID}/fields で返る uniqueId を CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID に設定してください。`,
        },
        { status: 500 },
      );
    }

    const resolvedHousing =
      resolveEmptyFillHousingStatusFieldId(constructionFields);
    if (!resolvedHousing) {
      return NextResponse.json(
        {
          error:
            "住宅ステータスフィールドが見つかりません。工事アプリに「住宅ステータス」列があるか、CALENDAR_EMPTY_FILL_HOUSING_STATUS_FIELD_ID を設定してください。",
        },
        { status: 500 },
      );
    }

    const handlerFieldEnv = calendarConstructionHandlerFieldIdFromEnv();
    let resolvedHandlerField: string | undefined;
    let handlerValueToPut: string | undefined;

    if (handlerFieldEnv) {
      if (!constructionHandlerStaffConfigReady()) {
        return NextResponse.json(
          {
            error:
              "工事対応者はスタッフ名簿と連携する必要があります。STAFF_APP_ID・STAFF_NAME_FIELD_ID・STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID を設定してください。",
          },
          { status: 503 },
        );
      }
      const resolved = resolveConfiguredFieldToSchemaUniqueId(
        handlerFieldEnv,
        constructionFields,
      );
      if (!resolved) {
        return NextResponse.json(
          {
            error:
              `工事対応者フィールド「${handlerFieldEnv}」が工事アプリのフィールド定義と一致しません。GET /api/apps/{アプリID}/fields の uniqueId を CALENDAR_EMPTY_FILL_CONSTRUCTION_HANDLER_FIELD_ID（または後方互換 CALENDAR_EMPTY_FILL_CONSTRUCTION_REGISTRANT_FIELD_ID）に設定してください。`,
          },
          { status: 500 },
        );
      }
      resolvedHandlerField = resolved;
      if (!constructionHandlerStaffRecordId) {
        return NextResponse.json(
          { error: "工事対応者を選択してください" },
          { status: 400 },
        );
      }
      const resolvedName = await resolveConstructionHandlerNameForActiveStaff(
        constructionHandlerStaffRecordId,
      );
      if (!resolvedName.ok) {
        const msg =
          resolvedName.reason === "not_found"
            ? "選択したスタッフが見つかりません。"
            : resolvedName.reason === "not_active"
              ? "選択した社員は工事対応が「稼働」ではありません。一覧を更新して選び直してください。"
              : resolvedName.reason === "no_name"
                ? "スタッフ名簿に氏名が入っていません。"
                : "工事対応者を検証できませんでした。";
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      handlerValueToPut = resolvedName.name;
    }

    const fids = resolveConstructionFieldIds(constructionFields);
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


    /**
     * 取込キー（Aki番号）。@pocket は取込キーの列が本文に無いと更新を拒む。
     * 以前は T番号 がこの役だったが、採番元がお客様情報アプリへ移った
     */
    const resolvedImportKey =
      resolveConstructionImportKeyFieldId(constructionFields);
    if (!resolvedImportKey) {
      return NextResponse.json(
        {
          error:
            "取込キー（Aki番号）フィールドの uniqueId が分かりません。CALENDAR_CONSTRUCTION_IMPORT_KEY_FIELD_ID を .env に設定するか、アプリに「Aki番号」見出しのフィールドを用意してください。",
        },
        { status: 500 },
      );
    }

    const fieldsCsv = uniqueFieldsCsv(
      resolvedCustomer,
      resolvedHousing,
      resolvedTNumber,
      resolvedImportKey,
      fids.startDate,
      fids.shigumi,
      fids.panelWork,
      fids.electricWork,
      fids.appSettingsDay,
    );

    const recRow = await fetchConstructionRecordRow(
      calAppId,
      recordId,
      readAuth,
      fieldsCsv,
    );

    if (!recRow?.record || typeof recRow.record !== "object") {
      return NextResponse.json({ error: "レコードが見つかりません" }, { status: 404 });
    }

    const recObj = recRow.record as Record<string, unknown>;
    if (!constructionTitleFieldIsEmpty(recObj, resolvedCustomer)) {
      const { status, body } = calendarSlotConflictResponse();
      return NextResponse.json(body, { status });
    }

    /**
     * T番号 は**空でもよい**。工事アプリで採番しなくなったため、
     * この空き枠がまだお客様情報と紐づいていなければ入っていない。
     * 弾かずに進め、連携のあとに書き戻す
     */
    const existingT =
      readConstructionTNumberFromRecord(recObj, resolvedTNumber) ?? "";

    const existingAki =
      readConstructionTNumberFromRecord(recObj, resolvedImportKey) ?? "";

    const patch = buildConstructionFillPatch({
      resolvedCustomer,
      resolvedHousing,
      resolvedImportKey,
      importKeyValue: existingAki,
      resolvedTNumber,
      tNumberValue: existingT,
      customerName,
      housingRaw,
      resolvedHandlerField,
      handlerValue: handlerValueToPut,
      fids,
      shigumiDate: body.shigumiDate,
      panelWorkDate: body.panelWorkDate,
      electricWorkDate: body.electricWorkDate,
      appSettingsDayDate: body.appSettingsDayDate,
    });

    const freshSlot = await readFreshConstructionEmptySlotState(
      calAppId,
      recordId,
      readAuth,
      resolvedCustomer,
    );
    if (!freshSlot.ok) {
      return NextResponse.json({ error: "レコードが見つかりません" }, { status: 404 });
    }
    if (!freshSlot.isEmpty) {
      const { status, body: conflictBody } = calendarSlotConflictResponse();
      return NextResponse.json(conflictBody, { status });
    }

    await writePocketRecordWithImportKey({
      appId: calAppId,
      recordId,
      payload: patch,
      importKeyFieldId: resolvedImportKey,
      existingRecord: recObj,
      readAuth,
      writeAuth,
      allowMissingImportKey: true,
    });
    constructionUpdated = true;

    // 空き枠への入力（ベストエフォート。書き込みは確定済み）
    await recordAuditLog({
      lineUserId: auth.lineUserId,
      operation: "update",
      targetAppId: calAppId,
      targetRecordId: recordId,
      targetTNumber: existingT,
      changes: computeAuditChanges(recObj, patch, {
        labelOf: (fieldId) => fieldCaptionByUniqueId(constructionFields, fieldId),
      }),
    });

    invalidateAllCalendarPayloadCache();

    return finalizeConstructionCalendarSave({
      calAppId,
      constructionRecordId: recordId,
      constructionUniqueKey: existingT,
      constructionImportKey: existingAki,
      customerName,
      housingStatus: housingRaw,
      constructionFields,
      calendarAuth: writeAuth,
      lineUserId: auth.lineUserId,
      viewYear: body.viewYear,
      viewMonth: body.viewMonth,
      savedVerb: "更新",
      /**
       * 新規案件通知は**連携がお客様情報を新規作成したときだけ**送る。
       *
       * 空き枠の更新なので工事レコードは既にあるが、そこへ入れた
       * お客様名の顧客がお客様情報に無ければ、連携が新規作成して
       * T番号 が新規採番される（＝新規案件）。既存が突合キーで
       * 見つかれば採番済みの T番号 を読むだけなので送らない。
       * どちらになるかはこの時点では決まらないため、判定は
       * finalizeConstructionCalendarSave に任せる（判定は1箇所）
       */
      notifyNewCase: "when-customer-info-created",
    });
  } catch (e) {
    console.error("[api/calendar/fill-empty-slot]", e);
    const detail = formatConstructionCreateRecordError(
      e instanceof Error ? e.message : String(e),
    );
    if (constructionUpdated) {
      return NextResponse.json(
        {
          error: `${detail}（工事アプリへの更新は完了しています）`,
          constructionSaved: true,
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        error:
          detail.includes("list fields failed") || detail.includes("403")
            ? `工事アプリの設定取得に失敗しました。CALENDAR_ATPOCKET_API_KEY（工事アプリ参照権限のあるキー）と CALENDAR_APP_ID を確認してください。(${detail})`
            : "レコードの更新に失敗しました。しばらくしてから再度お試しください。",
      },
      { status: 502 },
    );
  }
}
