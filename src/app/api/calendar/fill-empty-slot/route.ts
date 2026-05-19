import { NextResponse } from "next/server";

import {
  EMPTY_FILL_HOUSING_STATUS_NEW_BUILD,
  isValidEmptyFillHousingStatus,
} from "@/lib/calendar-empty-fill-options";
import { optionalCalendarYmd } from "@/lib/calendar-optional-ymd";
import {
  constructionTitleFieldIsEmpty,
  pickRecordValueByFieldAliases,
  resolveConfiguredFieldToSchemaUniqueId,
  resolveConstructionFieldIds,
} from "@/lib/calendar-kojo";
import {
  apiKeyForCalendarPocket,
  fetchAppFields,
  fetchRecordById,
  updateRecord,
} from "@/lib/atpocket";
import { calendarConstructionHandlerFieldIdFromEnv } from "@/lib/calendar-construction-handler-env";
import { syncConstructionRecordToCustomerInfoApp } from "@/lib/sync-construction-to-customer-info";
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
};

/** GET/PUT に載せるフィールドは必要なもののみ（それ以外を PUT すると「有効なフィールドではありません」になることがある） */
function uniqueFieldsCsv(...uids: (string | undefined)[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const u of uids) {
    const t = u?.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      parts.push(t);
    }
  }
  return parts.join(",");
}

/** @pocket へレコード PUT（フィールドキーは GET fields で解決した uniqueId をそのまま使う） */
async function updateFillEmptySlotPocketRecord(
  calAppId: string,
  calendarRecordId: string,
  pocketAuth: { apiKey: string },
  patch: Record<string, unknown>,
): Promise<void> {
  await updateRecord(calAppId, calendarRecordId, patch, pocketAuth);
}

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

  const pocketAuth = { apiKey: apiKeyForCalendarPocket() };

  let constructionUpdated = false;

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
    const tNumberRaw =
      process.env.CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID?.trim() ||
      fids.tNumber?.trim();

    if (!tNumberRaw) {
      return NextResponse.json(
        {
          error:
            "T番号フィールドの uniqueId が分かりません。CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID を .env に設定するか、アプリに「T番号」見出しのフィールドを用意してください。",
        },
        { status: 500 },
      );
    }

    const resolvedTNumber = resolveConfiguredFieldToSchemaUniqueId(
      tNumberRaw,
      constructionFields,
    );
    if (!resolvedTNumber) {
      return NextResponse.json(
        {
          error:
            `T番号フィールド「${tNumberRaw}」が工事アプリのフィールド定義と一致しません。GET /api/apps/{アプリID}/fields で返る uniqueId を設定してください。`,
        },
        { status: 500 },
      );
    }

    const fieldsCsv = uniqueFieldsCsv(
      resolvedCustomer,
      resolvedHousing,
      resolvedTNumber,
    );

    let recRow: Awaited<ReturnType<typeof fetchRecordById>> = null;
    try {
      recRow = await fetchRecordById(
        calAppId,
        recordId,
        pocketAuth,
        fieldsCsv,
      );
    } catch {
      recRow = await fetchRecordById(calAppId, recordId, pocketAuth);
    }

    if (!recRow?.record || typeof recRow.record !== "object") {
      return NextResponse.json({ error: "レコードが見つかりません" }, { status: 404 });
    }

    const recObj = recRow.record as Record<string, unknown>;
    if (!constructionTitleFieldIsEmpty(recObj, resolvedCustomer)) {
      return NextResponse.json(
        {
          error:
            "このレコードはお客様名が既に入っているため、工事空枠として更新できません",
        },
        { status: 409 },
      );
    }

    const existingT = pickRecordValueByFieldAliases(recObj, resolvedTNumber);
    if (existingT === undefined || existingT === null) {
      return NextResponse.json(
        {
          error:
            "このレコードから T番号 を取得できませんでした。@pocket で空枠に T番号 が入っているか、フィールド設定を確認してください。",
        },
        { status: 409 },
      );
    }

    const patch: Record<string, unknown> = {
      [resolvedTNumber]: existingT,
      [resolvedCustomer]: customerName,
      [resolvedHousing]: housingRaw,
    };
    if (resolvedHandlerField != null && handlerValueToPut != null) {
      patch[resolvedHandlerField] = handlerValueToPut;
    }

    if (housingRaw === EMPTY_FILL_HOUSING_STATUS_NEW_BUILD) {
      const quad: Array<[fieldId: string | undefined, raw: string | undefined]> =
        [
          [fids.shigumi, body.shigumiDate],
          [fids.panelWork, body.panelWorkDate],
          [fids.electricWork, body.electricWorkDate],
          [fids.appSettingsDay, body.appSettingsDayDate],
        ];
      for (const [fid, raw] of quad) {
        const ymd = optionalCalendarYmd(raw);
        const id = fid?.trim();
        if (ymd && id) patch[id] = ymd;
      }
    }

    await updateFillEmptySlotPocketRecord(
      calAppId,
      recordId,
      pocketAuth,
      patch,
    );
    constructionUpdated = true;

    const customerSync = await syncConstructionRecordToCustomerInfoApp({
      calAppId,
      constructionRecordId: recordId,
      customerName,
      constructionFields,
      calendarAuth: pocketAuth,
    });
    if (customerSync.kind === "failed") {
      return NextResponse.json(
        {
          error: `${customerSync.error}（工事アプリへの更新は完了しています）`,
          constructionSaved: true,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      customerInfoSynced: customerSync.kind === "synced",
    });
  } catch (e) {
    console.error("[api/calendar/fill-empty-slot]", e);
    const detail = e instanceof Error ? e.message : String(e);
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
            ? `工事アプリの設定取得に失敗しました。CALENDAR_ATPOCKET_API_KEY と CALENDAR_APP_ID を確認してください。(${detail})`
            : "レコードの更新に失敗しました。しばらくしてから再度お試しください。",
      },
      { status: 502 },
    );
  }
}
