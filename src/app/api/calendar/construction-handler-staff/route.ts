import { NextResponse } from "next/server";

import {
  constructionHandlerStaffConfigReady,
  fetchConstructionHandlerStaffCandidates,
} from "@/lib/staff-construction-handler-candidates";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

/**
 * 工事対応者プルダウン用。
 * スタッフ名簿で工事対応稼働状況が「稼働」の行、および常時含める氏名を返す。
 */
export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  if (!constructionHandlerStaffConfigReady()) {
    return NextResponse.json(
      {
        error:
          "工事対応者リスト用の環境変数が不足しています。STAFF_APP_ID・STAFF_NAME_FIELD_ID・STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID を設定してください。",
      },
      { status: 503 },
    );
  }

  try {
    const handlers = await fetchConstructionHandlerStaffCandidates();
    return NextResponse.json({ handlers, registrants: handlers });
  } catch (e) {
    console.error("[api/calendar/construction-handler-staff]", e);
    return NextResponse.json(
      { error: "工事対応者リストの取得に失敗しました" },
      { status: 502 },
    );
  }
}
