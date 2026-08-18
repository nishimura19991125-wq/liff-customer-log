import { NextResponse } from "next/server";

import {
  apiKeyForCalendarPocket1,
  apiKeyForCalendarWrite,
  fetchAppFields,
  fetchRecordById,
} from "@/lib/atpocket";
import { writePocketRecordWithImportKey } from "@/lib/atpocket-write-with-import-key";
import { recordAuditLog } from "@/lib/audit-log";
import { computeAuditChanges } from "@/lib/audit-log-changes";
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
import { invalidateCalendarConstructionRecordsCache } from "@/lib/calendar-construction-records-cache";
import {
  constructionTitleFieldIsEmpty,
  pickRecordValueByFieldAliases,
  resolveConstructionFieldIds,
  resolveConstructionTNumberFieldId,
  resolveEmptyFillHousingStatusFieldId,
} from "@/lib/calendar-kojo";
import { constructionRecordHasAnyWorkDate } from "@/lib/calendar-undated-cases";
import { fieldCaptionByUniqueId } from "@/lib/customer-info-record";
import { isCustomerTNumberCancelled } from "@/lib/customer-cancelled-t-numbers";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

/**
 * 工事日未定の既存案件に、施工予定日と施工会社を書き込む（タスクS-3）。
 *
 * 「空き枠を使わずに登録する」を選んだときの経路。空き枠には一切触らない
 * ので、このルートに削除は無い。空き枠を消費する場合は従来どおり
 * assign-case-to-slot を使う（削除経路は増やさない）。
 *
 * 書き込みの中身は assign-case-to-slot と同じ部品
 * （buildConstructionFillPatch / writePocketRecordWithImportKey /
 * finalizeConstructionCalendarSave）を使い、ロジックを再実装しない。
 */

type Body = {
  caseRecordId?: string;
  scheduledStartDate?: string;
  contractor?: string;
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

  const caseRecordId = body.caseRecordId?.trim() ?? "";
  const scheduledStartDate = optionalCalendarYmd(body.scheduledStartDate);
  const contractor = body.contractor?.trim() ?? "";

  if (!caseRecordId || !scheduledStartDate) {
    return NextResponse.json(
      {
        error: "caseRecordId と scheduledStartDate（YYYY-MM-DD）は必須です",
      },
      { status: 400 },
    );
  }
  // 施工会社はこの導線では必須（空き枠との照合に使う）
  if (!contractor) {
    return NextResponse.json(
      { error: "施工会社を選択してください" },
      { status: 400 },
    );
  }

  const readAuth = { apiKey: apiKeyForCalendarPocket1() };
  const writeAuth = { apiKey: apiKeyForCalendarWrite() };

  let constructionUpdated = false;

  try {
    const constructionFields = await fetchAppFields(calAppId, readAuth, {
      operation: "calendar:未定案件日付設定fields",
      appEnv: "CALENDAR_APP_ID",
    });

    const fids = resolveConstructionFieldIds(constructionFields);
    const titleId = fids.title?.trim();
    if (!titleId) {
      return NextResponse.json(
        {
          error:
            "お客様名フィールドを特定できません。工事アプリの列見出しを確認してください。",
        },
        { status: 500 },
      );
    }

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

    if (!fids.contractor?.trim()) {
      return NextResponse.json(
        {
          error:
            "施工会社フィールドを特定できません。工事アプリに「施工会社」列があるか、CALENDAR_CONTRACTOR_FIELD_ID を設定してください。",
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

    const caseFieldsCsv = uniqueFieldsCsv(
      titleId,
      resolvedHousing,
      resolvedTNumber,
      startDateId,
      fids.contractor,
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
        { error: "対象の案件レコードが見つかりません" },
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
            "顧客ステータスが「キャンセル」の案件は登録できません。別の未定案件を選んでください。",
        },
        { status: 400 },
      );
    }

    const patch = buildConstructionFillPatch({
      resolvedCustomer: titleId,
      resolvedHousing,
      resolvedTNumber,
      tNumberValue: existingT,
      customerName,
      housingRaw: housingStatus,
      fids,
      scheduledStartDate,
      contractor,
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

    invalidateCalendarConstructionRecordsCache();
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
      extraResponse: { scheduledWithoutSlot: true },
    });
  } catch (e) {
    console.error("[api/calendar/schedule-undated-case]", e);
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
            ? `工事アプリの設定取得に失敗しました。CALENDAR_ATPOCKET_API_KEY と CALENDAR_APP_ID を確認してください。(${detail})`
            : "施工予定日の登録に失敗しました。しばらくしてから再度お試しください。",
      },
      { status: 502 },
    );
  }
}
