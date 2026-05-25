import { NextResponse } from "next/server";

import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import {
  resolveBoundStaffPinContext,
  verifyStaffPin,
} from "@/lib/staff-pin-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON が不正です" }, { status: 400 });
  }

  const pin =
    typeof body === "object" &&
    body !== null &&
    "pin" in body &&
    typeof (body as { pin?: unknown }).pin === "string"
      ? (body as { pin: string }).pin.trim()
      : "";

  if (!pin) {
    return NextResponse.json({ error: "暗証番号が必要です" }, { status: 400 });
  }

  try {
    const ctx = await resolveBoundStaffPinContext(auth.lineUserId);
    if (!ctx.ok) {
      return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    }

    const result = await verifyStaffPin(ctx, pin);
    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          ...(result.needsInitialSetup ? { needsInitialSetup: true } : {}),
        },
        { status: result.needsInitialSetup ? 403 : 401 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/staff/pin/verify]", e);
    const msg = e instanceof Error ? e.message : "暗証番号の確認に失敗しました";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
