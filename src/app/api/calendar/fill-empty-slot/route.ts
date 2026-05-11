import { NextResponse } from "next/server";

import { isValidEmptyFillHousingStatus } from "@/lib/calendar-empty-fill-options";
import { constructionTitleFieldIsEmpty } from "@/lib/calendar-kojo";
import {
  apiKeyForCalendarPocket,
  fetchRecordById,
  updateRecord,
} from "@/lib/atpocket";
import { resolveCallerLineUserId } from "@/lib/request-auth";

export const dynamic = "force-dynamic";

type Body = {
  recordId?: string;
  customerName?: string;
  housingStatus?: string;
};

export async function POST(request: Request) {
  if (!(await resolveCallerLineUserId(request))) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

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

  try {
    const recRow = await fetchRecordById(calAppId, recordId, pocketAuth);
    if (!recRow?.record || typeof recRow.record !== "object") {
      return NextResponse.json({ error: "レコードが見つかりません" }, { status: 404 });
    }

    const recObj = recRow.record as Record<string, unknown>;
    if (!constructionTitleFieldIsEmpty(recObj, customerField)) {
      return NextResponse.json(
        {
          error:
            "このレコードはお客様名が既に入っているため、工事空枠として更新できません",
        },
        { status: 409 },
      );
    }

    const patch: Record<string, unknown> = {
      [customerField]: customerName,
      [housingField]: housingRaw,
    };

    await updateRecord(calAppId, recordId, patch, pocketAuth);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/calendar/fill-empty-slot]", e);
    const detail =
      e instanceof Error ? e.message.slice(0, 800) : String(e).slice(0, 800);
    return NextResponse.json(
      { error: "レコードの更新に失敗しました", detail },
      { status: 502 },
    );
  }
}
