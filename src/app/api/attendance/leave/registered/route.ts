import { NextResponse } from "next/server";

import { pocketErrorResponse } from "@/lib/api-error-response";
import { getRegisteredLeavesForLineUser } from "@/lib/leave-registered-server";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

/**
 * 休みの登録画面用（読み取りのみ）。
 * 登録できる期間と、本人の登録済みの日（日付だけ）を返す。氏名は載せない。
 */
export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  try {
    const result = await getRegisteredLeavesForLineUser(auth.lineUserId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const { ok: _ok, ...body } = result;
    return NextResponse.json(body);
  } catch (e) {
    return pocketErrorResponse(e, {
      scope: "api/attendance/leave/registered",
      message: "休暇登録の状況を取得できませんでした。しばらくしてから再度お試しください。",
    });
  }
}
