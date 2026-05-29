import { NextResponse } from "next/server";

import { resolveConstructionRecordAfterCreate } from "@/lib/atpocket-record-id";
import {
  apiKeyForCalendarPocket,
  apiKeyForCalendarWrite,
  createRecord,
  fetchAppFields,
} from "@/lib/atpocket";
import { finalizeConstructionCalendarSave } from "@/lib/calendar-after-construction-save";
import { formatConstructionCreateRecordError } from "@/lib/calendar-construction-create-error";
import { invalidateAllCalendarPayloadCache } from "@/lib/calendar-response-cache";
import { calendarConstructionHandlerFieldIdFromEnv } from "@/lib/calendar-construction-handler-env";
import {
  EMPTY_FILL_HOUSING_STATUS_NEW_BUILD,
  isValidEmptyFillHousingStatus,
} from "@/lib/calendar-empty-fill-options";
import {
  resolveConfiguredFieldToSchemaUniqueId,
  resolveConstructionFieldIds,
  resolveConstructionTNumberFieldId,
} from "@/lib/calendar-kojo";
import { optionalCalendarYmd } from "@/lib/calendar-optional-ymd";
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
  viewYear?: number;
  viewMonth?: number;
};

/**
 * 工事アプリに新規レコードを追加（空枠更新と同じフィールド設定を利用）。
 * T番号はリクエストに含めず、@pocket の自動採番に任せる。
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
          "登録先フィールドが未設定です。.env に CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID と CALENDAR_EMPTY_FILL_HOUSING_STATUS_FIELD_ID を設定してください。",
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

  const handlerFieldEnv = calendarConstructionHandlerFieldIdFromEnv();

  let handlerPutValue: string | undefined;
  let resolvedHandlerField: string | undefined;

  /** 工事日未定案件登録では工事対応者は任意。送信されたときのみ検証して書き込む */
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
    handlerPutValue = resolvedName.name;
  }

  /** 書込専用キー未設定時は CALENDAR_ATPOCKET_API_KEY が登録・一覧の両方に使われる */
  const pocketWriteAuth = { apiKey: apiKeyForCalendarWrite() };
  const pocketReadAuth = { apiKey: apiKeyForCalendarPocket() };

  let constructionSaved = false;

  try {
    const constructionFields = await fetchAppFields(calAppId, pocketReadAuth);

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
            `住宅ステータスフィールド「${housingField}」が工事アプリのフィールド定義と一致しません。`,
        },
        { status: 500 },
      );
    }

    if (handlerFieldEnv && handlerPutValue != null) {
      const resolved = resolveConfiguredFieldToSchemaUniqueId(
        handlerFieldEnv,
        constructionFields,
      );
      if (!resolved) {
        return NextResponse.json(
          {
            error:
              `工事対応者フィールド「${handlerFieldEnv}」が工事アプリのフィールド定義と一致しません。CALENDAR_EMPTY_FILL_CONSTRUCTION_HANDLER_FIELD_ID を確認してください。`,
          },
          { status: 500 },
        );
      }
      resolvedHandlerField = resolved;
    }

    const constructionFids = resolveConstructionFieldIds(constructionFields);
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

    const record: Record<string, unknown> = {
      [resolvedCustomer]: customerName,
      [resolvedHousing]: housingRaw,
    };
    if (resolvedHandlerField != null && handlerPutValue != null) {
      record[resolvedHandlerField] = handlerPutValue;
    }

    if (housingRaw === EMPTY_FILL_HOUSING_STATUS_NEW_BUILD) {
      const quad: Array<[fieldId: string | undefined, raw: string | undefined]> =
        [
          [constructionFids.shigumi, body.shigumiDate],
          [constructionFids.panelWork, body.panelWorkDate],
          [constructionFids.electricWork, body.electricWorkDate],
          [constructionFids.appSettingsDay, body.appSettingsDayDate],
        ];
      for (const [fid, raw] of quad) {
        const ymd = optionalCalendarYmd(raw);
        const id = fid?.trim();
        if (ymd && id) record[id] = ymd;
      }
    }

    /** 自動採番: 空で送り @pocket に付番させる（取込キー検証を通す） */
    record[resolvedTNumber] = "";

    const createResult = await createRecord(calAppId, record, pocketWriteAuth);
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
        startDateFieldId: constructionFids.startDate?.trim() || undefined,
        tNumberFieldId: resolvedTNumber,
      },
      pocketReadAuth,
    );

    return finalizeConstructionCalendarSave({
      calAppId,
      constructionRecordId: constructionMatch.recordId,
      constructionUniqueKey: constructionMatch.uniqueKey,
      customerName,
      constructionFields,
      calendarAuth: pocketReadAuth,
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
