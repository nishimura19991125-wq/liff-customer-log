import { NextResponse } from "next/server";

import {
  apiKeyForCalendarPocket1,
  apiKeyForCalendarWrite,
  deleteRecord,
  fetchAppFields,
  fetchRecordById,
  updateRecord,
} from "@/lib/atpocket";
import { finalizeConstructionCalendarSave } from "@/lib/calendar-after-construction-save";
import { uniqueFieldsCsv } from "@/lib/calendar-construction-pocket-common";
import { optionalCalendarYmd } from "@/lib/calendar-optional-ymd";
import { invalidateAllCalendarPayloadCache } from "@/lib/calendar-response-cache";
import {
  constructionTitleFieldIsEmpty,
  pickRecordValueByFieldAliases,
  resolveConfiguredFieldToSchemaUniqueId,
  resolveConstructionFieldIds,
  resolveConstructionTNumberFieldId,
  resolveEmptyFillHousingStatusFieldId,
} from "@/lib/calendar-kojo";
import {
  calendarSlotConflictResponse,
  readFreshConstructionEmptySlotState,
} from "@/lib/calendar-slot-reservation";
import {
  callerOwnsCaseByTNumber,
  constructionRecordHasAnyWorkDate,
} from "@/lib/calendar-undated-cases";
import {
  customerInfoAppId,
  customerInfoImportKeyFieldId,
  customerInfoPocketAuth,
} from "@/lib/customer-info-config";
import { resolveCustomerInfoFormFieldId } from "@/lib/customer-info-form/resolve-fields";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { defaultApClStaffNamesForLineUser } from "@/lib/staff-ap-cl-candidates";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

type Body = {
  slotRecordId?: string;
  caseRecordId?: string;
  slotDayKey?: string;
  viewYear?: number;
  viewMonth?: number;
};

function coercePlainString(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw).trim();
  }
  if (Array.isArray(raw)) {
    return raw.map(coercePlainString).filter(Boolean).join(" ");
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const k of ["value", "displayValue", "label", "name", "text"]) {
      const v = o[k];
      if (v != null && (typeof v === "string" || typeof v === "number")) {
        return String(v).trim();
      }
    }
  }
  return String(raw).trim();
}

/**
 * 工事日未定の既存案件を空き枠の日付に割り当てる。
 * 案件レコードに施工予定日を書き込み、空き枠レコードを削除する。
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

  const slotRecordId = body.slotRecordId?.trim() ?? "";
  const caseRecordId = body.caseRecordId?.trim() ?? "";
  const slotDayKey = optionalCalendarYmd(body.slotDayKey);

  if (!slotRecordId || !caseRecordId || !slotDayKey) {
    return NextResponse.json(
      {
        error:
          "slotRecordId・caseRecordId・slotDayKey（YYYY-MM-DD）はすべて必須です",
      },
      { status: 400 },
    );
  }

  if (slotRecordId === caseRecordId) {
    return NextResponse.json(
      { error: "空き枠と割り当て案件に同じレコードは指定できません" },
      { status: 400 },
    );
  }

  const readAuth = { apiKey: apiKeyForCalendarPocket1() };
  const writeAuth = { apiKey: apiKeyForCalendarWrite() };

  let constructionUpdated = false;
  let slotDeleted = false;

  try {
    const constructionFields = await fetchAppFields(calAppId, readAuth, {
      operation: "calendar:未定案件割り当てfields",
      appEnv: "CALENDAR_APP_ID",
    });

    const resolvedCustomer = resolveConfiguredFieldToSchemaUniqueId(
      customerField,
      constructionFields,
    );
    if (!resolvedCustomer) {
      return NextResponse.json(
        {
          error: `お客様名フィールド「${customerField}」が工事アプリのフィールド定義と一致しません。`,
        },
        { status: 500 },
      );
    }

    const fids = resolveConstructionFieldIds(constructionFields);
    const startDateId = fids.startDate?.trim();
    if (!startDateId) {
      return NextResponse.json(
        {
          error:
            "施工予定日フィールドを特定できません。工事アプリに「施工予定日」列があるか確認してください。",
        },
        { status: 500 },
      );
    }

    const titleId = fids.title?.trim() || resolvedCustomer;
    const housingId =
      resolveEmptyFillHousingStatusFieldId(constructionFields) ||
      fids.housingStatus?.trim() ||
      "";

    const freshSlot = await readFreshConstructionEmptySlotState(
      calAppId,
      slotRecordId,
      readAuth,
      resolvedCustomer,
    );
    if (!freshSlot.ok) {
      return NextResponse.json(
        { error: "空き枠レコードが見つかりません" },
        { status: 404 },
      );
    }
    if (!freshSlot.isEmpty) {
      const { status, body: conflictBody } = calendarSlotConflictResponse();
      return NextResponse.json(conflictBody, { status });
    }

    const caseFieldsCsv = uniqueFieldsCsv(
      titleId,
      housingId,
      startDateId,
      fids.shigumi,
      fids.panelWork,
      fids.electricWork,
      fids.appSettingsDay,
      resolveConstructionTNumberFieldId(constructionFields) ?? undefined,
    );
    let caseRow = await fetchRecordById(
      calAppId,
      caseRecordId,
      readAuth,
      caseFieldsCsv,
    );
    if (!caseRow?.record) {
      caseRow = await fetchRecordById(calAppId, caseRecordId, readAuth);
    }
    if (!caseRow?.record || typeof caseRow.record !== "object") {
      return NextResponse.json(
        { error: "割り当て対象の案件レコードが見つかりません" },
        { status: 404 },
      );
    }

    const caseRec = caseRow.record as Record<string, unknown>;
    if (constructionTitleFieldIsEmpty(caseRec, titleId)) {
      return NextResponse.json(
        {
          error:
            "選択したレコードにお客様名が入っていません。工事日未定の既存案件を選んでください。",
        },
        { status: 400 },
      );
    }
    if (constructionRecordHasAnyWorkDate(caseRec, constructionFields, fids)) {
      return NextResponse.json(
        {
          error:
            "選択した案件には既に工事日が入っています。別の未定案件を選んでください。",
        },
        { status: 409 },
      );
    }

    const customerName = coercePlainString(
      pickRecordValueByFieldAliases(caseRec, titleId),
    );
    if (!customerName) {
      return NextResponse.json(
        { error: "案件のお客様名を取得できませんでした" },
        { status: 400 },
      );
    }

    const housingStatus = housingId
      ? coercePlainString(pickRecordValueByFieldAliases(caseRec, housingId))
      : "";

    // ログイン者がAP/CL担当の案件か（お客様情報のT番号突合）
    const customerAppId = customerInfoAppId();
    const customerKeyEnv = customerInfoImportKeyFieldId();
    if (customerAppId && customerKeyEnv) {
      const { apStaff, clStaff } = await defaultApClStaffNamesForLineUser(
        auth.lineUserId,
      );
      if (!apStaff && !clStaff) {
        return NextResponse.json(
          {
            error:
              "スタッフ紐付けが必要です。LINEアカウントとスタッフ名簿の紐付け後に割り当ててください。",
            needsStaffBind: true,
          },
          { status: 403 },
        );
      }

      const tNumberId = resolveConstructionTNumberFieldId(constructionFields);
      const tNumber = tNumberId
        ? coercePlainString(
            pickRecordValueByFieldAliases(caseRec, tNumberId),
          )
        : "";
      if (!tNumber) {
        return NextResponse.json(
          {
            error:
              "案件のT番号を取得できないため、担当確認ができません。",
          },
          { status: 400 },
        );
      }

      const customerAuth = customerInfoPocketAuth();
      const customerFields = await fetchAppFields(customerAppId, customerAuth, {
        operation: "calendar:未定案件割り当て(お客様情報fields)",
        appEnv: "CUSTOMER_INFO_APP_ID",
      });
      const customerKeyFieldId = resolveConfiguredFieldToSchemaUniqueId(
        customerKeyEnv,
        customerFields,
      );
      if (!customerKeyFieldId) {
        return NextResponse.json(
          {
            error: `お客様情報のT番号フィールド「${customerKeyEnv}」が定義と一致しません`,
          },
          { status: 500 },
        );
      }
      const owns = await callerOwnsCaseByTNumber(tNumber, {
        customerAppId,
        customerKeyFieldId,
        apStaffFieldId: resolveCustomerInfoFormFieldId(
          "apStaff",
          "AP担当者",
          customerFields,
        ),
        clStaffFieldId: resolveCustomerInfoFormFieldId(
          "clStaff",
          "CL担当者",
          customerFields,
        ),
        callerApStaff: apStaff,
        callerClStaff: clStaff,
        customerAuth,
      });
      if (!owns) {
        return NextResponse.json(
          {
            error:
              "この案件はあなたのAP/CL担当ではありません。担当の未定案件のみ割り当てできます。",
          },
          { status: 403 },
        );
      }
    }

    // 書き込み直前に空き枠を再確認
    const freshAgain = await readFreshConstructionEmptySlotState(
      calAppId,
      slotRecordId,
      readAuth,
      resolvedCustomer,
    );
    if (!freshAgain.ok) {
      return NextResponse.json(
        { error: "空き枠レコードが見つかりません" },
        { status: 404 },
      );
    }
    if (!freshAgain.isEmpty) {
      const { status, body: conflictBody } = calendarSlotConflictResponse();
      return NextResponse.json(conflictBody, { status });
    }

    await updateRecord(
      calAppId,
      caseRecordId,
      { [startDateId]: slotDayKey },
      writeAuth,
    );
    constructionUpdated = true;

    try {
      await deleteRecord(calAppId, slotRecordId, writeAuth);
      slotDeleted = true;
    } catch (delErr) {
      console.error(
        "[api/calendar/assign-case-to-slot] slot delete failed",
        delErr,
      );
      invalidateAllCalendarPayloadCache();
      const detail =
        delErr instanceof Error ? delErr.message : String(delErr);
      return NextResponse.json(
        {
          error: `${detail}（案件への工事日の反映は完了していますが、空き枠の削除に失敗しました。カレンダーを確認してください）`,
          constructionSaved: true,
        },
        { status: 502 },
      );
    }

    invalidateAllCalendarPayloadCache();

    return finalizeConstructionCalendarSave({
      calAppId,
      constructionRecordId: caseRecordId,
      customerName,
      housingStatus: housingStatus || undefined,
      constructionFields,
      calendarAuth: writeAuth,
      lineUserId: auth.lineUserId,
      viewYear: body.viewYear,
      viewMonth: body.viewMonth,
      savedVerb: "更新",
      extraResponse: {
        assignedFromSlot: true,
        slotRecordId,
        slotDeleted,
      },
    });
  } catch (e) {
    console.error("[api/calendar/assign-case-to-slot]", e);
    const detail = e instanceof Error ? e.message : String(e);
    if (constructionUpdated) {
      return NextResponse.json(
        {
          error: `${detail}（工事アプリへの更新は完了しています${
            slotDeleted ? "・空き枠も削除済みです" : ""
          }）`,
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
            : "未定案件の割り当てに失敗しました。しばらくしてから再度お試しください。",
      },
      { status: 502 },
    );
  }
}
