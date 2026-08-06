import { NextResponse } from "next/server";

import { pocketErrorResponse } from "@/lib/api-error-response";

import { getAttendanceStatusForLineUser } from "@/lib/attendance-server";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const url = new URL(request.url);
  const bypassCache = url.searchParams.get("refresh") === "1";

  try {
    const status = await getAttendanceStatusForLineUser(auth.lineUserId, {
      bypassCache,
    });
    return NextResponse.json(status);
  } catch (e) {
    return pocketErrorResponse(e, {
      scope: "api/attendance",
      message: "勤怠情報の取得に失敗しました",
    });
  }
}
