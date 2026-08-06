import { NextResponse } from "next/server";

import { pocketErrorResponse } from "@/lib/api-error-response";

import {
  resolveConfiguredFieldToSchemaUniqueId,
} from "@/lib/calendar-kojo";
import {
  calendarSlotConflictResponse,
  readFreshConstructionEmptySlotState,
} from "@/lib/calendar-slot-reservation";
import { apiKeyForCalendarPocket1, fetchAppFields } from "@/lib/atpocket";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

/** 工事空枠がまだ空か（@pocket 直読・キャッシュ不使用） */
export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const calAppId = process.env.CALENDAR_APP_ID?.trim();
  if (!calAppId) {
    return NextResponse.json(
      { error: "CALENDAR_APP_ID が未設定です", disabled: true },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const recordId = url.searchParams.get("recordId")?.trim();
  if (!recordId) {
    return NextResponse.json(
      { error: "recordId が必要です" },
      { status: 400 },
    );
  }

  const customerField =
    process.env.CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID?.trim() ||
    process.env.CALENDAR_EMPTY_FILL_TITLE_FIELD_ID?.trim();
  if (!customerField) {
    return NextResponse.json(
      { error: "CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID が未設定です" },
      { status: 500 },
    );
  }

  const readAuth = { apiKey: apiKeyForCalendarPocket1() };

  try {
    const constructionFields = await fetchAppFields(calAppId, readAuth, {
      operation: "calendar:空枠検証fields",
      appEnv: "CALENDAR_APP_ID",
    });
    const resolvedCustomer = resolveConfiguredFieldToSchemaUniqueId(
      customerField,
      constructionFields,
    );
    if (!resolvedCustomer) {
      return NextResponse.json(
        { error: "お客様名列を解決できません" },
        { status: 500 },
      );
    }

    const state = await readFreshConstructionEmptySlotState(
      calAppId,
      recordId,
      readAuth,
      resolvedCustomer,
    );

    if (!state.ok) {
      return NextResponse.json(
        { error: "レコードが見つかりません" },
        { status: 404 },
      );
    }

    if (!state.isEmpty) {
      const { status, body } = calendarSlotConflictResponse();
      return NextResponse.json(body, { status });
    }

    return NextResponse.json({ available: true, recordId });
  } catch (e) {
    return pocketErrorResponse(e, {
      scope: "api/calendar/verify-empty-slot",
      message: "空枠の確認に失敗しました",
    });
  }
}
