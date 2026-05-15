import { NextResponse } from "next/server";

import {
  constructionRegistrantStaffConfigReady,
  fetchConstructionRegistrantCandidates,
} from "@/lib/staff-registrant-candidates";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

/**
 * 工事登録者プルダウン用。スタッフ名簿で工事対応稼働状況が「稼働」の行のみ返す。
 */
export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  if (!constructionRegistrantStaffConfigReady()) {
    return NextResponse.json(
      {
        error:
          "工事登録者リスト用の環境変数が不足しています。STAFF_APP_ID・STAFF_NAME_FIELD_ID・STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID を設定してください。",
      },
      { status: 503 },
    );
  }

  try {
    const registrants = await fetchConstructionRegistrantCandidates();
    return NextResponse.json({ registrants });
  } catch (e) {
    console.error("[api/calendar/registrant-staff]", e);
    return NextResponse.json(
      { error: "工事登録者リストの取得に失敗しました" },
      { status: 502 },
    );
  }
}
