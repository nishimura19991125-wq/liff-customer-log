import { NextResponse } from "next/server";

import {
  apiKeyForCalendarPocket,
  createRecord,
  fetchAppFields,
  updateRecord,
} from "@/lib/atpocket";
import { finalizeConstructionCalendarSave } from "@/lib/calendar-after-construction-save";
import {
  buildConstructionFillPatch,
  ensureConstructionTNumberOnRecord,
  resolveConstructionRecordAfterCreate,
  uniqueFieldsCsv,
} from "@/lib/calendar-construction-pocket-common";
import { formatConstructionCreateRecordError } from "@/lib/calendar-construction-create-error";
import { invalidateAllCalendarPayloadCache } from "@/lib/calendar-response-cache";
import { calendarConstructionHandlerFieldIdFromEnv } from "@/lib/calendar-construction-handler-env";
import { isValidEmptyFillHousingStatus } from "@/lib/calendar-empty-fill-options";
import { optionalCalendarYmd } from "@/lib/calendar-optional-ymd";
import {
  resolveConfiguredFieldToSchemaUniqueId,
  resolveConstructionFieldIds,
  resolveConstructionTNumberFieldId,
} from "@/lib/calendar-kojo";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import {
  constructionHandlerStaffConfigReady,
  resolveConstructionHandlerNameForActiveStaff,
} from "@/lib/staff-construction-handler-candidates";

export const dynamic = "force-dynamic";
/** Netlify Pro 等で延長可能。Free はプラットフォーム上限（約10秒） */
export const maxDuration = 26;

/** 新築案件の任意日程（YYYY-MM-DD）。未送信・空は書き込まない */
type Body = {
  customerName?: string;
  housingStatus?: string;
  constructionHandlerStaffRecordId?: string;
  constructionRegistrantStaffRecordId?: string;
  shigumiDate?: string;
  panelWorkDate?: string;
  electricWorkDate?: string;
  appSettingsDayDate?: string;
  /** 施工予定日 YYYY-MM-DD（任意） */
  scheduledStartDate?: string;
  /** 施工会社（任意） */
  contractor?: string;
  viewYear?: number;
  viewMonth?: number;
};

/**
 * 工事カレンダー新規登録（工事日未定・日程都度調整案件）。工事空枠登録（fill-empty-slot）と同じ流れ:
 * 工事アプリへ書き込み → recordId 確定 → GET で T番号確認 → PUT → お客様情報連携
 */
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
  const housingField =
    process.env.CALENDAR_EMPTY_FILL_HOUSING_STATUS_FIELD_ID?.trim();

  if (!customerField || !housingField) {
    return NextResponse.json(
      {
        error:
          "工事空枠の入力先フィールドが未設定です。.env に CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID と CALENDAR_EMPTY_FILL_HOUSING_STATUS_FIELD_ID（@pocket の uniqueId）を設定してください。",
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

  const customerName = body.customerName?.trim();
  const housingRaw = body.housingStatus?.trim() ?? "";
  const constructionHandlerStaffRecordId =
    body.constructionHandlerStaffRecordId?.trim() ||
    body.constructionRegistrantStaffRecordId?.trim() ||
    "";

  if (!customerName || !housingRaw) {
    return NextResponse.json(
      { error: "お客様名・住宅ステータスはすべて必須です" },
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

  const scheduledStartDateRaw = body.scheduledStartDate?.trim() ?? "";
  const scheduledStartDate = optionalCalendarYmd(scheduledStartDateRaw);
  if (scheduledStartDateRaw && !scheduledStartDate) {
    return NextResponse.json(
      { error: "施工予定日は YYYY-MM-DD 形式で入力してください" },
      { status: 400 },
    );
  }
  const contractor = body.contractor?.trim() ?? "";

  const pocketAuth = { apiKey: apiKeyForCalendarPocket() };

  let constructionSaved = false;

  try {
    const constructionFields = await fetchAppFields(calAppId, pocketAuth);

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

    const resolvedHousing = resolveConfiguredFieldToSchemaUniqueId(
      housingField,
      constructionFields,
    );
    if (!resolvedHousing) {
      return NextResponse.json(
        {
          error:
            `住宅ステータスフィールド「${housingField}」が工事アプリのフィールド定義と一致しません。GET /api/apps/{アプリID}/fields で返る uniqueId を設定してください。`,
        },
        { status: 500 },
      );
    }

    const handlerFieldEnv = calendarConstructionHandlerFieldIdFromEnv();
    let resolvedHandlerField: string | undefined;
    let handlerValueToPut: string | undefined;

    /** 新規登録では工事対応者は任意。送信されたときのみ検証して書き込む */
    if (handlerFieldEnv && constructionHandlerStaffRecordId) {
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

    const fieldsCsv = uniqueFieldsCsv(
      resolvedCustomer,
      resolvedHousing,
      resolvedTNumber,
      fids.startDate,
      fids.contractor,
    );

    const patchExtras = {
      shigumiDate: body.shigumiDate,
      panelWorkDate: body.panelWorkDate,
      electricWorkDate: body.electricWorkDate,
      appSettingsDayDate: body.appSettingsDayDate,
      scheduledStartDate: scheduledStartDate ?? undefined,
      contractor: contractor || undefined,
    };

    const createResult = await createRecord(
      calAppId,
      buildConstructionFillPatch({
        resolvedCustomer,
        resolvedHousing,
        resolvedTNumber,
        tNumberValue: "",
        customerName,
        housingRaw,
        resolvedHandlerField,
        handlerValue: handlerValueToPut,
        fids,
        ...patchExtras,
      }),
      pocketAuth,
    );
    constructionSaved = true;
    invalidateAllCalendarPayloadCache();

    const constructionMatch = await resolveConstructionRecordAfterCreate(
      calAppId,
      createResult,
      {
        customerName,
        housingStatus: housingRaw,
        customerFieldId: resolvedCustomer,
        housingFieldId: resolvedHousing,
        startDateFieldId: fids.startDate?.trim() || undefined,
        tNumberFieldId: resolvedTNumber,
      },
      pocketAuth,
    );

    const recordId = constructionMatch.recordId;
    let uniqueKey = constructionMatch.uniqueKey;

    if (!recordId && !uniqueKey) {
      return NextResponse.json(
        {
          error:
            `工事レコードは登録されましたが、登録内容を再取得できませんでした（お客様名「${customerName}」で検索）。@pocket に案件があるか、CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID がお客様名列の uniqueId と一致しているか確認してください。`,
          constructionSaved: true,
        },
        { status: 502 },
      );
    }

    if (recordId) {
      const tNumber = await ensureConstructionTNumberOnRecord(
        calAppId,
        recordId,
        resolvedTNumber,
        pocketAuth,
        fieldsCsv,
      );
      uniqueKey = uniqueKey ?? tNumber;
      if (!uniqueKey) {
        return NextResponse.json(
          {
            error:
              "登録したレコードから T番号 を取得できませんでした。@pocket で T番号 が採番されているか、フィールド設定を確認してください。",
            constructionSaved: true,
          },
          { status: 409 },
        );
      }

      const patch = buildConstructionFillPatch({
        resolvedCustomer,
        resolvedHousing,
        resolvedTNumber,
        tNumberValue: uniqueKey,
        customerName,
        housingRaw,
        resolvedHandlerField,
        handlerValue: handlerValueToPut,
        fids,
        ...patchExtras,
      });

      await updateRecord(calAppId, recordId, patch, pocketAuth);
    }

    return finalizeConstructionCalendarSave({
      calAppId,
      constructionRecordId: recordId,
      constructionUniqueKey: uniqueKey,
      customerName,
      constructionFields,
      calendarAuth: pocketAuth,
      lineUserId: auth.lineUserId,
      viewYear: body.viewYear,
      viewMonth: body.viewMonth,
      savedVerb: "登録",
    });
  } catch (e) {
    console.error("[api/calendar/create-record]", e);
    const rawDetail = e instanceof Error ? e.message : String(e);
    const detail = formatConstructionCreateRecordError(rawDetail);
    if (constructionSaved) {
      return NextResponse.json(
        {
          error: `${detail}（工事アプリへの登録は完了しています）`,
          constructionSaved: true,
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        error:
          detail.includes("@pocket:")
            ? detail
            : "レコードの登録に失敗しました。APIキーの登録権限や@pocketの必須項目を確認してください。",
      },
      { status: 502 },
    );
  }
}
