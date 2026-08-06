import { NextResponse } from "next/server";

import { pocketErrorResponse } from "@/lib/api-error-response";

import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import {
  readStaffPinPublicState,
  resolveBoundStaffPinContext,
} from "@/lib/staff-pin-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  try {
    const ctx = await resolveBoundStaffPinContext(auth.lineUserId);
    if (!ctx.ok) {
      return NextResponse.json(
        { error: ctx.error, enabled: false },
        { status: ctx.status },
      );
    }

    const state = await readStaffPinPublicState(ctx);
    return NextResponse.json({
      ...state,
      staffName: ctx.staffName,
    });
  } catch (e) {
    return pocketErrorResponse(e, {
      scope: "api/staff/pin/status",
      message: "PIN状態の取得に失敗しました",
      extra: { enabled: false },
    });
  }
}
