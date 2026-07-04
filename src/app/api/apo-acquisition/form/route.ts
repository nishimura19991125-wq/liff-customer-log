import { NextResponse } from "next/server";

import { buildApoAcquisitionFormPayload } from "@/lib/apo-acquisition-server";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

/** アポ取得時入力フォームの選択肢・既定値 */
export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const boundStaffName = await resolveBoundStaffNameForLineUser(auth.lineUserId);
  if (!boundStaffName) {
    return NextResponse.json(
      { configured: false, needsStaffBind: true, error: "担当者の紐付けが必要です" },
      { status: 403 },
    );
  }

  try {
    const payload = await buildApoAcquisitionFormPayload(
      auth.lineUserId,
      boundStaffName,
    );
    return NextResponse.json(payload);
  } catch (e) {
    console.error("[api/apo-acquisition/form]", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { configured: false, error: msg || "フォーム情報の取得に失敗しました" },
      { status: 502 },
    );
  }
}
