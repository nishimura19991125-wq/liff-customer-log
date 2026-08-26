import { NextResponse } from "next/server";

import { pocketErrorResponse } from "@/lib/api-error-response";

import { buildApoListForStaff } from "@/lib/apo-list";
import { customerInfoConfigReady } from "@/lib/customer-info-config";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

/**
 * 担当者別のアポ情報一覧。
 *
 * 取得は商談進捗と同じキャッシュに相乗りするため、このルートが増えても
 * @pocket へのリクエストは増えない（詳細は buildApoListForStaff のコメント）。
 */
export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const cfg = customerInfoConfigReady();
  if (!cfg.ok) {
    return NextResponse.json(
      { disabled: true, error: cfg.error },
      { status: 503 },
    );
  }

  try {
    const boundStaffName = await resolveBoundStaffNameForLineUser(
      auth.lineUserId,
    );
    if (!boundStaffName) {
      return NextResponse.json({ needsStaffBind: true });
    }

    return NextResponse.json(await buildApoListForStaff(boundStaffName));
  } catch (e) {
    return pocketErrorResponse(e, {
      scope: "api/apo-list",
      message: "アポ情報一覧の取得に失敗しました",
    });
  }
}
