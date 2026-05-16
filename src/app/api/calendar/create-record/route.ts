import { NextResponse } from "next/server";

import {
  apiKeyForCalendarPocket,
  createRecord,
  fetchAppFields,
} from "@/lib/atpocket";
import { calendarConstructionHandlerFieldIdFromEnv } from "@/lib/calendar-construction-handler-env";
import {
  EMPTY_FILL_HOUSING_STATUS_NEW_BUILD,
  isValidEmptyFillHousingStatus,
} from "@/lib/calendar-empty-fill-options";
import {
  resolveConfiguredFieldToSchemaUniqueId,
  resolveConstructionFieldIds,
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
};

function optionalYmd(raw: string | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== m - 1 ||
    dt.getDate() !== d
  ) {
    return null;
  }
  return s;
}

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
    handlerPutValue = resolvedName.name;
  }

  const pocketAuth = { apiKey: apiKeyForCalendarPocket() };

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

    const record: Record<string, unknown> = {
      [resolvedCustomer]: customerName,
      [resolvedHousing]: housingRaw,
    };
    if (resolvedHandlerField != null && handlerPutValue != null) {
      record[resolvedHandlerField] = handlerPutValue;
    }

    if (housingRaw === EMPTY_FILL_HOUSING_STATUS_NEW_BUILD) {
      const fids = resolveConstructionFieldIds(constructionFields);
      const quad: Array<[fieldId: string | undefined, raw: string | undefined]> =
        [
          [fids.shigumi, body.shigumiDate],
          [fids.panelWork, body.panelWorkDate],
          [fids.electricWork, body.electricWorkDate],
          [fids.appSettingsDay, body.appSettingsDayDate],
        ];
      for (const [fid, raw] of quad) {
        const ymd = optionalYmd(raw);
        const id = fid?.trim();
        if (ymd && id) record[id] = ymd;
      }
    }

    await createRecord(calAppId, record);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/calendar/create-record]", e);
    return NextResponse.json(
      {
        error:
          "レコードの登録に失敗しました。APIキーの登録権限や@pocketの必須項目を確認してください。",
      },
      { status: 502 },
    );
  }
}
