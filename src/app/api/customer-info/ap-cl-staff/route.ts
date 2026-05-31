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
    const msg = e instanceof Error ? e.message : String(e);
    const rateLimited =
      msg.includes("429") || msg.includes("Too Many Request");
    return NextResponse.json(
      {
        configured: true,
        rosterEmpty: true,
        ap: { options: [], defaultName: null },
        cl: { options: [], defaultName: null },
        error: rateLimited
          ? "担当者一覧の取得が混み合っています。しばらくしてから再度お試しください。"
          : "AP/CL担当者リストの取得に失敗しました",
        configError: rateLimited
          ? "担当者一覧の取得が混み合っています。しばらくしてから再度お試しください。"
          : "AP/CL担当者リストの取得に失敗しました。しばらくしてから画面を更新してください。",
      },
      {
        status: rateLimited ? 429 : 502,
        ...(rateLimited ? { headers: { "Retry-After": "120" } } : {}),
      },
    );
  }
}
