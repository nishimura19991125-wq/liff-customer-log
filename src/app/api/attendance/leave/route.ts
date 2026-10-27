import { NextResponse } from "next/server";

import { pocketErrorResponse } from "@/lib/api-error-response";
import { registerLeavesForLineUser } from "@/lib/leave-register-server";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

/**
 * 休みを登録する（休暇・段階4）。
 *
 * 受け取るのは日付の配列だけ（{ dates: ["YYYY-MM-DD", ...] }）。
 * 従業員名はサーバが LINE の紐付けから決める。画面から来た値は使わない。
 */
export async function POST(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON が不正です" }, { status: 400 });
  }
  const dates =
    typeof body === "object" && body !== null && "dates" in body
      ? (body as { dates?: unknown }).dates
      : undefined;

  try {
    const result = await registerLeavesForLineUser(auth.lineUserId, dates);
    if (result.ok) {
      return NextResponse.json({
        ok: true,
        created: result.created,
        alreadyRegistered: result.alreadyRegistered,
      });
    }
    const { status, ...rest } = result;
    return NextResponse.json(rest, { status });
  } catch (e) {
    return pocketErrorResponse(e, {
      scope: "api/attendance/leave",
      message: "休暇登録に失敗しました。しばらくしてから再度お試しください。",
    });
  }
}
