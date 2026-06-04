import { NextResponse } from "next/server";

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
    console.error("[api/attendance]", e);
    const msg =
      e instanceof Error ? e.message : "勤怠情報の取得に失敗しました";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
