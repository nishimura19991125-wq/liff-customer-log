import { NextResponse } from "next/server";

import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import {
  requestStaffPinReset,
  resolveBoundStaffPinContext,
} from "@/lib/staff-pin-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  try {
    const ctx = await resolveBoundStaffPinContext(auth.lineUserId);
    if (!ctx.ok) {
      return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    }

    const { resetCode } = await requestStaffPinReset(ctx);
    return NextResponse.json({ ok: true, resetCode });
  } catch (e) {
    console.error("[api/staff/pin/reset-request]", e);
    const msg =
      e instanceof Error ? e.message : "リセットコードの発行に失敗しました";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
