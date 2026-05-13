import { NextResponse } from "next/server";

import { isValidEmptyFillHousingStatus } from "@/lib/calendar-empty-fill-options";
import {
  alternateNumericFieldUniqueId,
  constructionTitleFieldIsEmpty,
  pickRecordValueByFieldAliases,
  pocketFieldLooksLikeLinkage,
  resolveConfiguredFieldToSchemaUniqueId,
  resolveConstructionFieldIds,
  resolveEnvFieldUniqueIdForSchema,
} from "@/lib/calendar-kojo";
import {
  apiKeyForCalendarPocket,
  fetchAppFields,
  fetchRecordById,
  updateRecord,
} from "@/lib/atpocket";
import {
  pocketLinkageHandlerCandidateValues,
  type PocketLinkageHandlerPutOptions,
} from "@/lib/calendar-handler-link";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { staffImportKeyFieldIdResolved } from "@/lib/staff-import-key";
import {
  fetchStaffEmployeeIdByRecordId,
  resolveStaffRecordIdByEmployeeIdForConstructionHandler,
} from "@/lib/staff-resolve-construction-handler";
import { normalizeStaffEmployeeIdSearchInput } from "@/lib/staff-employee-id-format";

export const dynamic = "force-dynamic";

type Body = {
  recordId?: string;
  customerName?: string;
  housingStatus?: string;
  constructionHandler?: string;
  /** スタッフ名簿のレコード ID（連携項目・工事対応者向け） */
  constructionHandlerStaffRecordId?: string;
  /** スタッフ名簿の取込キー「社員 ID」（設定時はサーバーでレコード ID に変換して連携に載せる） */
  constructionHandlerEmployeeId?: string;
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

/** true のとき工事対応者には入力氏名のみ PUT（スタッフ解決・連携ペイロードの試行を行わない。連携項目でも氏名直接入力が通る @pocket 構成向け） */
function handlerPutDisplayNameOnly(): boolean {
  return (
    process.env.CALENDAR_EMPTY_FILL_HANDLER_PUT_DISPLAY_NAME_ONLY?.trim() ===
    "true"
  );
}

/** @pocket が「工事対応者ID」としてテキストの社員番号等を要求するとき（CALENDAR_EMPTY_FILL_HANDLER_LINK_FORMAT） */
function handlerPutWantsEmployeeIdString(): boolean {
  const r =
    process.env.CALENDAR_EMPTY_FILL_HANDLER_LINK_FORMAT?.trim().toLowerCase() ||
    "";
  return (
    r === "employee_id_string" ||
    r === "construction_handler_id_string" ||
    r === "handler_id_string"
  );
}

function pocketUpdateRecordErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** PUT が同一項目で hyphen / underscore の別キーを要求するときに1回だけ差し替え試行する */
async function updateFillEmptySlotPocketRecord(
  calAppId: string,
  calendarRecordId: string,
  pocketAuth: { apiKey: string },
  patch: Record<string, unknown>,
  handlerSchemaKey: string | undefined,
): Promise<void> {
  try {
    await updateRecord(calAppId, calendarRecordId, patch, pocketAuth);
    return;
  } catch (e) {
    const msg = pocketUpdateRecordErrorMessage(e);
    const handlerVal =
      handlerSchemaKey !== undefined ? patch[handlerSchemaKey] : undefined;
    if (
      handlerSchemaKey === undefined ||
      handlerVal === undefined ||
      !msg.includes("400") ||
      !msg.includes("有効なフィールドではありません")
    ) {
      throw e;
    }
    const altKey = alternateNumericFieldUniqueId(handlerSchemaKey);
    if (!altKey || altKey === handlerSchemaKey) throw e;
    const patch2 = { ...patch };
    delete patch2[handlerSchemaKey];
    patch2[altKey] = handlerVal;
    await updateRecord(calAppId, calendarRecordId, patch2, pocketAuth);
  }
}

/** 工事対応者ID形式エラー時のみ連携ペイロードの候補を順に試す */
async function updateFillEmptySlotPocketRecordWithLinkageFallback(
  calAppId: string,
  calendarRecordId: string,
  pocketAuth: { apiKey: string },
  patch: Record<string, unknown>,
  resolvedHandlerField: string | undefined,
  linkageStaffRecordId: string | undefined,
  displayNameFallback: string,
  linkageOpts: PocketLinkageHandlerPutOptions | undefined,
): Promise<void> {
  if (!resolvedHandlerField) {
    await updateFillEmptySlotPocketRecord(
      calAppId,
      calendarRecordId,
      pocketAuth,
      patch,
      undefined,
    );
    return;
  }

  const candidates = pocketLinkageHandlerCandidateValues(
    linkageStaffRecordId,
    displayNameFallback,
    linkageOpts,
  );

  let lastErr: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const patchTry = { ...patch, [resolvedHandlerField]: candidates[i] };
    try {
      await updateFillEmptySlotPocketRecord(
        calAppId,
        calendarRecordId,
        pocketAuth,
        patchTry,
        resolvedHandlerField,
      );
      return;
    } catch (e) {
      lastErr = e;
      const msg = pocketUpdateRecordErrorMessage(e);
      const linkageFmtErr =
        msg.includes("400") && msg.includes("工事対応者IDの形式");
      if (!linkageFmtErr || i === candidates.length - 1) {
        throw e;
      }
    }
  }
  throw lastErr;
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
  const constructionHandlerField =
    process.env.CALENDAR_EMPTY_FILL_CONSTRUCTION_HANDLER_FIELD_ID?.trim();

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
  const constructionHandlerRaw = body.constructionHandler?.trim() ?? "";
  const constructionHandlerStaffRecordId =
    body.constructionHandlerStaffRecordId?.trim() ?? "";
  const constructionHandlerEmployeeId =
    body.constructionHandlerEmployeeId?.trim() ?? "";

  if (!recordId || !customerName || !housingRaw) {
    return NextResponse.json(
      { error: "recordId・お客様名・住宅ステータスはすべて必須です" },
      { status: 400 },
    );
  }

  if (
    constructionHandlerField &&
    !constructionHandlerStaffRecordId &&
    !constructionHandlerEmployeeId &&
    !constructionHandlerRaw
  ) {
    return NextResponse.json(
      { error: "工事対応者は必須です" },
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

    let resolvedHandlerField: string | undefined;
    if (constructionHandlerField) {
      const resolved = resolveEnvFieldUniqueIdForSchema(
        constructionHandlerField,
        constructionFields,
      );
      if (!resolved) {
        return NextResponse.json(
          {
            error:
              `工事対応者フィールド「${constructionHandlerField}」が工事アプリのフィールド定義と一致しません。@pocket の Web API（GET /api/apps/{アプリID}/fields）で返る uniqueId を CALENDAR_EMPTY_FILL_CONSTRUCTION_HANDLER_FIELD_ID に設定してください。管理画面の「field-32」と API の「field_32」など表記が異なる場合は自動で読み替えますが、それ以外の ID の場合は API の値をそのまま設定してください。`,
          },
          { status: 500 },
        );
      }
      resolvedHandlerField = resolved;

      const handlerFieldRow = constructionFields.find(
        (f) => f.uniqueId?.trim() === resolvedHandlerField,
      );
      if (
        !handlerPutDisplayNameOnly() &&
        handlerPutWantsEmployeeIdString() &&
        pocketFieldLooksLikeLinkage(handlerFieldRow)
      ) {
        return NextResponse.json(
          {
            error:
              "工事対応者の項目は「連携項目」（スタッフ名簿と紐づく）のため、プレーンな社員ID文字列を送る CALENDAR_EMPTY_FILL_HANDLER_LINK_FORMAT=employee_id_string は使えません。その設定を削除または空にして既定の連携形式（apps_record_array）にしてください。CALENDAR_EMPTY_FILL_CONSTRUCTION_HANDLER_FIELD_ID は画面の識別名どおり API の uniqueId（例: field-52）を設定してください。単一行連携のみのときは apps_record_object を試すこともできます。",
          },
          { status: 400 },
        );
      }
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
      resolvedHandlerField,
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

    /** GET fields で返る uniqueId をそのまま PUT に使う（hyphen / underscore はスキーマに合わせて解決済み） */
    const patch: Record<string, unknown> = {
      [resolvedTNumber]: existingT,
      [resolvedCustomer]: customerName,
      [resolvedHousing]: housingRaw,
    };
    if (resolvedHandlerField) {
      if (handlerPutDisplayNameOnly()) {
        const nameOnly = constructionHandlerRaw.trim();
        if (!nameOnly) {
          return NextResponse.json(
            { error: "工事対応者（名前）は必須です。" },
            { status: 400 },
          );
        }
        patch[resolvedHandlerField] = nameOnly;
      } else {
        let linkageStaffRecordId = constructionHandlerStaffRecordId;
        if (!linkageStaffRecordId && constructionHandlerEmployeeId) {
          if (!staffImportKeyFieldIdResolved()) {
            return NextResponse.json(
              {
                error:
                  "社員 ID で保存するには、スタッフ名簿の「社員 ID」列の uniqueId を STAFF_IMPORT_KEY_FIELD_ID（または BIND 設定から自動解決できる状態）に設定してください。",
              },
              { status: 500 },
            );
          }
          const staffAppId = process.env.STAFF_APP_ID?.trim();
          const nameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim();
          const availabilityFieldId =
            process.env.STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID?.trim();
          const activeLabel =
            process.env.STAFF_CONSTRUCTION_AVAILABILITY_ACTIVE_LABEL?.trim() ||
            "稼働";
          if (!staffAppId || !nameFieldId || !availabilityFieldId) {
            return NextResponse.json(
              {
                error:
                  "社員 ID からレコードを解決できません。STAFF_APP_ID・STAFF_NAME_FIELD_ID・STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID を設定してください。",
              },
              { status: 500 },
            );
          }
          const resolved =
            await resolveStaffRecordIdByEmployeeIdForConstructionHandler({
              staffAppId,
              employeeIdSearch: constructionHandlerEmployeeId,
              nameFieldId,
              availabilityFieldId,
              activeLabel,
            });
          if (!resolved) {
            return NextResponse.json(
              {
                error:
                  "入力された社員 ID に一致する、工事対応稼働中の担当者が見つかりません。@pocket のスタッフ名簿を確認してください。",
              },
              { status: 400 },
            );
          }
          linkageStaffRecordId = resolved;
        }

        const wantsEmployeeIdString = handlerPutWantsEmployeeIdString();
        let employeeIdForPut = constructionHandlerEmployeeId;
        if (
          wantsEmployeeIdString &&
          linkageStaffRecordId &&
          !employeeIdForPut.trim()
        ) {
          const staffAppId = process.env.STAFF_APP_ID?.trim();
          if (staffAppId && staffImportKeyFieldIdResolved()) {
            const fetched = await fetchStaffEmployeeIdByRecordId(
              staffAppId,
              linkageStaffRecordId,
              pocketAuth,
            );
            if (fetched) employeeIdForPut = fetched;
          }
        }

        if (employeeIdForPut.trim()) {
          employeeIdForPut = normalizeStaffEmployeeIdSearchInput(
            employeeIdForPut.trim(),
          );
        }

        if (wantsEmployeeIdString && !employeeIdForPut.trim()) {
          return NextResponse.json(
            {
              error:
                "工事対応者フィールドが「工事対応者ID」を要求しています。.env に CALENDAR_EMPTY_FILL_HANDLER_LINK_FORMAT=employee_id_string と STAFF_IMPORT_KEY_FIELD_ID（スタッフ名簿の社員 ID 列）を確認してください。社員 ID が 000001 のような先頭ゼロ付きなら STAFF_EMPLOYEE_ID_ZERO_PAD_LENGTH=6 も設定してください。プルダウンから選び直してください。",
            },
            { status: 400 },
          );
        }

        const linkageOpts: PocketLinkageHandlerPutOptions = {
          employeeId: employeeIdForPut.trim() || undefined,
        };

        await updateFillEmptySlotPocketRecordWithLinkageFallback(
          calAppId,
          recordId,
          pocketAuth,
          patch,
          resolvedHandlerField,
          linkageStaffRecordId || undefined,
          constructionHandlerRaw,
          linkageOpts,
        );
      }
    } else {
      await updateFillEmptySlotPocketRecord(
        calAppId,
        recordId,
        pocketAuth,
        patch,
        undefined,
      );
    }

    if (resolvedHandlerField && handlerPutDisplayNameOnly()) {
      await updateFillEmptySlotPocketRecord(
        calAppId,
        recordId,
        pocketAuth,
        patch,
        resolvedHandlerField,
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/calendar/fill-empty-slot]", e);
    return NextResponse.json(
      {
        error:
          "レコードの更新に失敗しました。しばらくしてから再度お試しください。",
      },
      { status: 502 },
    );
  }
}
