import { NextResponse } from "next/server";

import { pocketErrorResponse } from "@/lib/api-error-response";

import { customerInfoConfigReady } from "@/lib/customer-info-config";
import { updateMeetingScheduleScheduledForStaff } from "@/lib/meeting-schedule";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ recordId: string }> };

/** 商談進捗情報の商談・資料送付予定日時更新 */
export async function PATCH(request: Request, ctx: RouteCtx) {
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

  let body: { scheduledYmd?: string; scheduledTime?: string };
  try {
    body = (await request.json()) as {
      scheduledYmd?: string;
      scheduledTime?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const scheduledYmd = body.scheduledYmd?.trim();
  if (!scheduledYmd) {
    return NextResponse.json(
      { error: "scheduledYmd が必要です" },
      { status: 400 },
    );
  }

  try {
    const boundStaffName = await resolveBoundStaffNameForLineUser(
      auth.lineUserId,
    );
    if (!boundStaffName) {
      return NextResponse.json({ needsStaffBind: true }, { status: 403 });
    }

    const result = await updateMeetingScheduleScheduledForStaff(
      boundStaffName,
      recordId,
      {
        scheduledYmd,
        scheduledTime: body.scheduledTime,
      },
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      ok: true,
      scheduledYmd: result.scheduledYmd,
      scheduledTime: result.scheduledTime,
      estimateStatus: result.estimateStatus,
    });
  } catch (e) {
    return pocketErrorResponse(e, {
      scope: "api/meeting-schedule/schedule",
      message: "商談・資料送付予定日時の更新に失敗しました",
    });
  }
}
