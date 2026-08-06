import { NextResponse } from "next/server";

import { pocketErrorResponse } from "@/lib/api-error-response";

import { customerInfoConfigReady } from "@/lib/customer-info-config";
import { updateMeetingScheduleStatusForStaff } from "@/lib/meeting-schedule";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ recordId: string }> };

/** 商談進捗情報の見積ステータス更新 */
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

  let body: {
    status?: string;
    meetingDate?: string;
    closeType?: string;
    meetingPlace?: string;
    responseDate?: string;
  };
  try {
    body = (await request.json()) as {
      status?: string;
      meetingDate?: string;
      closeType?: string;
      meetingPlace?: string;
      responseDate?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const status = body.status?.trim();
  if (!status) {
    return NextResponse.json({ error: "status が必要です" }, { status: 400 });
  }

  try {
    const boundStaffName = await resolveBoundStaffNameForLineUser(
      auth.lineUserId,
    );
    if (!boundStaffName) {
      return NextResponse.json({ needsStaffBind: true }, { status: 403 });
    }

    const result = await updateMeetingScheduleStatusForStaff(
      boundStaffName,
      recordId,
      {
        status,
        meetingDate: body.meetingDate,
        closeType: body.closeType,
        meetingPlace: body.meetingPlace,
        responseDate: body.responseDate,
      },
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      ok: true,
      estimateStatus: result.estimateStatus,
    });
  } catch (e) {
    return pocketErrorResponse(e, {
      scope: "api/meeting-schedule/status",
      message: "見積ステータスの更新に失敗しました",
    });
  }
}
