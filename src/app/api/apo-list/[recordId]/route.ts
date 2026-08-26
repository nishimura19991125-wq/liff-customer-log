import { NextResponse } from "next/server";

import { pocketErrorResponse } from "@/lib/api-error-response";

import { buildApoDetailForStaff } from "@/lib/apo-detail";
import { customerInfoConfigReady } from "@/lib/customer-info-config";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ recordId: string }> };

/**
 * アポ情報の詳細（1件）。
 *
 * 担当者の制限は buildApoDetailForStaff が recordMatchesStaff で行う。
 * 他人の案件の recordId を直接指定しても 403 になる。
 */
export async function GET(request: Request, ctx: RouteCtx) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const cfg = customerInfoConfigReady();
  if (!cfg.ok) {
    return NextResponse.json(
      { disabled: true, error: cfg.error },
      { status: 503 },
    );
  }

  const { recordId } = await ctx.params;

  try {
    const boundStaffName = await resolveBoundStaffNameForLineUser(
      auth.lineUserId,
    );
    if (!boundStaffName) {
      return NextResponse.json({ needsStaffBind: true });
    }

    const result = await buildApoDetailForStaff(boundStaffName, recordId);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }
    return NextResponse.json(result.payload);
  } catch (e) {
    return pocketErrorResponse(e, {
      scope: "api/apo-list/detail",
      message: "アポ情報の取得に失敗しました",
    });
  }
}
