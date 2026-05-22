import { NextResponse } from "next/server";

import { customerInfoConfigReady } from "@/lib/customer-info-config";
import { fetchApClStaffPickerPayload } from "@/lib/staff-ap-cl-candidates";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

/** お客様情報の AP/CL担当者プルダウン用 */
export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const cfg = customerInfoConfigReady();
  if (!cfg.ok) {
    return NextResponse.json(
      { error: cfg.error, disabled: true },
      { status: 503 },
    );
  }

  try {
    const payload = await fetchApClStaffPickerPayload(auth.lineUserId);
    return NextResponse.json(payload);
  } catch (e) {
    console.error("[api/customer-info/ap-cl-staff]", e);
    return NextResponse.json(
      { error: "AP/CL担当者リストの取得に失敗しました" },
      { status: 502 },
    );
  }
}
