import { NextResponse } from "next/server";

import {
  apiKeyForCalendarPocket1,
  apiKeyForCalendarWrite,
  deleteRecord,
  fetchAppFields,
  fetchRecordById,
} from "@/lib/atpocket";
import { writePocketRecordWithImportKey } from "@/lib/atpocket-write-with-import-key";
import { recordAuditLog } from "@/lib/audit-log";
import {
  computeAuditChanges,
  formatDeletionContent,
} from "@/lib/audit-log-changes";
import { finalizeConstructionCalendarSave } from "@/lib/calendar-after-construction-save";
import {
  buildConstructionFillPatch,
  ensureConstructionTNumberOnRecord,
  readConstructionTNumberFromRecord,
  uniqueFieldsCsv,
} from "@/lib/calendar-construction-pocket-common";
import { formatConstructionCreateRecordError } from "@/lib/calendar-construction-create-error";
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
  constructionRecordHasAnyWorkDate,
} from "@/lib/calendar-undated-cases";
import { fieldCaptionByUniqueId } from "@/lib/customer-info-record";
import { isCustomerTNumberCancelled } from "@/lib/customer-cancelled-t-numbers";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

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

    const titleId = fids.title?.trim() || resolvedCustomer;
    const resolvedHousing =
      resolveEmptyFillHousingStatusFieldId(constructionFields) ||
      fids.housingStatus?.trim() ||
      "";
    if (!resolvedHousing) {
      return NextResponse.json(
        {
          error:
            "住宅ステータスフィールドが見つかりません。工事アプリに「住宅ステータス」列があるか、CALENDAR_EMPTY_FILL_HOUSING_STATUS_FIELD_ID を設定してください。",
        },
        { status: 500 },
      );
    }

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
      resolvedHousing,
      resolvedTNumber,
      startDateId,
      fids.shigumi,
      fids.panelWork,
      fids.electricWork,
      fids.appSettingsDay,
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

    const housingStatus = coercePlainString(
      pickRecordValueByFieldAliases(caseRec, resolvedHousing),
    );

    let existingT = readConstructionTNumberFromRecord(caseRec, resolvedTNumber);
    if (!existingT) {
      existingT = await ensureConstructionTNumberOnRecord(
        calAppId,
        caseRecordId,
        resolvedTNumber,
        readAuth,
        caseFieldsCsv,
      );
    }
    if (!existingT) {
      return NextResponse.json(
        {
          error:
            "案件の T番号 を取得できません。@pocket で T番号 が入っているか、フィールド設定を確認してください。",
        },
        { status: 400 },
      );
    }

    if (await isCustomerTNumberCancelled(existingT)) {
      return NextResponse.json(
        {
          error:
            "顧客ステータスが「キャンセル」の案件は割り当てできません。別の未定案件を選んでください。",
        },
        { status: 400 },
      );
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

    const contractorFieldId = fids.contractor?.trim();
    let slotContractor = "";
    if (contractorFieldId) {
      const slotRow = await fetchRecordById(
        calAppId,
        slotRecordId,
        readAuth,
        uniqueFieldsCsv(resolvedCustomer, contractorFieldId),
      );
      if (slotRow?.record && typeof slotRow.record === "object") {
        slotContractor = coercePlainString(
          pickRecordValueByFieldAliases(
            slotRow.record as Record<string, unknown>,
            contractorFieldId,
          ),
        );
      }
    }

    const patch = buildConstructionFillPatch({
      resolvedCustomer: titleId,
      resolvedHousing,
      resolvedTNumber,
      tNumberValue: existingT,
      customerName,
      housingRaw: housingStatus,
      fids,
      scheduledStartDate: slotDayKey,
      contractor: slotContractor || undefined,
    });

    await writePocketRecordWithImportKey({
      appId: calAppId,
      recordId: caseRecordId,
      payload: patch,
      importKeyFieldId: resolvedTNumber,
      existingRecord: caseRec,
      readAuth,
      writeAuth,
    });
    constructionUpdated = true;

    // 案件側の日程更新（ベストエフォート。失敗しても更新は確定済み）
    await recordAuditLog({
      lineUserId: auth.lineUserId,
      operation: "update",
      targetAppId: calAppId,
      targetRecordId: caseRecordId,
      targetTNumber: existingT,
      changes: computeAuditChanges(caseRec, patch, {
        labelOf: (fieldId) => fieldCaptionByUniqueId(constructionFields, fieldId),
      }),
    });

    // A-4: 物理削除はログが唯一の復元手段なので、
    // 削除前に全項目を記録し、書き込みに成功したときだけ deleteRecord を実行する。
    const slotFullRow = await fetchRecordById(calAppId, slotRecordId, readAuth);
    const slotFullRecord =
      slotFullRow?.record && typeof slotFullRow.record === "object"
        ? (slotFullRow.record as Record<string, unknown>)
        : null;
    if (!slotFullRecord) {
      invalidateAllCalendarPayloadCache();
      return NextResponse.json(
        {
          error:
            "空き枠レコードを取得できなかったため、削除前の記録を残せません。案件への工事日の反映は完了しています。カレンダーを確認してください。",
          constructionSaved: true,
        },
        { status: 502 },
      );
    }

    const deletionLog = await recordAuditLog({
      lineUserId: auth.lineUserId,
      operation: "delete",
      targetAppId: calAppId,
      targetRecordId: slotRecordId,
      targetTNumber: existingT,
      deletionContent: formatDeletionContent(slotFullRecord, {
        labelOf: (fieldId) => fieldCaptionByUniqueId(constructionFields, fieldId),
      }),
    });
    if (!deletionLog.ok) {
      invalidateAllCalendarPayloadCache();
      return NextResponse.json(
        {
          error: `空き枠の削除記録を残せなかったため、削除を中止しました（${deletionLog.error}）。案件への工事日の反映は完了しています。時間をおいて再度お試しください。`,
          constructionSaved: true,
        },
        { status: 502 },
      );
    }

    try {
      await deleteRecord(calAppId, slotRecordId, writeAuth);
      slotDeleted = true;
    } catch (delErr) {
      console.error(
        "[api/calendar/assign-case-to-slot] slot delete failed",
        delErr,
      );
      invalidateAllCalendarPayloadCache();
      return NextResponse.json(
        {
          error:
            "案件への工事日の反映は完了していますが、空き枠の削除に失敗しました。カレンダーを確認してください。",
          constructionSaved: true,
        },
        { status: 502 },
      );
    }

    invalidateAllCalendarPayloadCache();

    return finalizeConstructionCalendarSave({
      calAppId,
      constructionRecordId: caseRecordId,
      constructionUniqueKey: existingT,
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
    const detail = formatConstructionCreateRecordError(
      e instanceof Error ? e.message : String(e),
    );
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
