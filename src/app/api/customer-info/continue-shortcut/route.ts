import { NextResponse } from "next/server";

import { customerInfoConfigReady } from "@/lib/customer-info-config";
import { findCustomerInfoPendingRecordsCached } from "@/lib/customer-info-pending-cache";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const cfg = customerInfoConfigReady();
  if (!cfg.ok) {
    return NextResponse.json(
      { shortcuts: [], disabled: true, error: cfg.error },
      { status: 503 },
    );
  }

  try {
    const boundStaffName = await resolveBoundStaffNameForLineUser(
      auth.lineUserId,
    );
    if (!boundStaffName) {
      return NextResponse.json({ shortcuts: [] });
    }

    const shortcuts = await findCustomerInfoPendingRecordsCached(boundStaffName);
    return NextResponse.json({ shortcuts });
  } catch (e) {
    console.error("[api/customer-info/continue-shortcut]", e);
    const msg =
      e instanceof Error ? e.message : "続き入力の確認に失敗しました";
    return NextResponse.json({ error: msg, shortcuts: [] }, { status: 502 });
  }
}
