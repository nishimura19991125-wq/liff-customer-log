import { NextResponse } from "next/server";

import {
  apiKeyForCalendarPocket,
  fetchAppFields,
} from "@/lib/atpocket";
import type { ConstructionHandlerHomePayload } from "@/lib/calendar-api-types";
import { fetchCalendarConstructionRecordsCached } from "@/lib/calendar-construction-records-cache";
import {
  buildConstructionHandlerHomeCases,
  buildConstructionRecordsFromTodayQuery,
  collectConstructionFieldsCsv,
  resolveConstructionFieldIds,
} from "@/lib/calendar-kojo";
import { resolveConstructionMapAddressFieldIds } from "@/lib/map-address-fields";
import { jstDateKey } from "@/lib/missing-documents-cache";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

/** ログイン中スタッフが工事対応者の案件（本日以降） */
export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const calAppId = process.env.CALENDAR_APP_ID?.trim();
  if (!calAppId) {
    const payload: ConstructionHandlerHomePayload = {
      configured: false,
      disabled: true,
      staffName: "",
      items: [],
      error: "CALENDAR_APP_ID が未設定です",
    };
    return NextResponse.json(payload, { status: 503 });
  }

  try {
    const boundStaffName = await resolveBoundStaffNameForLineUser(
      auth.lineUserId,
    );
    if (!boundStaffName) {
      const payload: ConstructionHandlerHomePayload = {
        configured: true,
        staffName: "",
        items: [],
        needsStaffBind: true,
      };
      return NextResponse.json(payload);
    }

    const calAuth = { apiKey: apiKeyForCalendarPocket() };
    const constructionFields = await fetchAppFields(calAppId, calAuth, {
      operation: "calendar:工事対応ホームfields",
      appEnv: "CALENDAR_APP_ID",
    });

    const fids = resolveConstructionFieldIds(constructionFields);
    if (!fids.constructionHandler?.trim()) {
      const payload: ConstructionHandlerHomePayload = {
        configured: false,
        staffName: boundStaffName,
        items: [],
        error: "工事対応者フィールドが設定されていません",
      };
      return NextResponse.json(payload);
    }

    const mapAddressIds =
      resolveConstructionMapAddressFieldIds(constructionFields);
    const csv = collectConstructionFieldsCsv(fids, mapAddressIds);
    const todayYmd = jstDateKey();

    const recordsQueryFilterDisabled =
      process.env.CALENDAR_RECORDS_QUERY_FILTER?.trim() === "false";
    const pocketQuery = recordsQueryFilterDisabled
      ? null
      : buildConstructionRecordsFromTodayQuery(fids, todayYmd);

    const constructionRecords = await fetchCalendarConstructionRecordsCached(
      calAppId,
      csv,
      pocketQuery,
    );

    const items = buildConstructionHandlerHomeCases(
      constructionRecords,
      constructionFields,
      boundStaffName,
      todayYmd,
    );

    const payload: ConstructionHandlerHomePayload = {
      configured: true,
      staffName: boundStaffName,
      items,
    };
    return NextResponse.json(payload);
  } catch (e) {
    console.error("[api/calendar/my-construction-cases]", e);
    const msg =
      e instanceof Error
        ? e.message
        : "工事対応案件の取得に失敗しました";
    return NextResponse.json(
      {
        configured: true,
        staffName: "",
        items: [],
        error: msg,
      } satisfies ConstructionHandlerHomePayload,
      { status: 502 },
    );
  }
}
