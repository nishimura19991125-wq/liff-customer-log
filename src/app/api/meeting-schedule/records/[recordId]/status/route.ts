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

/**
 * 商談進捗情報の更新。
 *
 * 見積ステータスは LIFF から変更できない（@pocket 側で変更する）が、
 * このルートは**付随項目**（初回商談実施日・片クロor両クロ・商談場所・
 * 返待ち回答日）も運んでいるため、ここで 400 にすると他項目の保存まで
 * 巻き込んで止めてしまう。
 *
 * そのため body の status は受け取り続け（付随項目の必須判定に使う）、
 * @pocket へ送る payload から見積ステータスの列を落とす方式にしている。
 * 実装は updateMeetingScheduleStatusForStaff の
 * stripLockedMeetingScheduleFieldsFromPayload 周辺。
 * 定義は src/lib/meeting-schedule-locked-fields.ts。
 */
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
    negotiationStatus?: string;
  };
  try {
    body = (await request.json()) as {
      status?: string;
      meetingDate?: string;
      closeType?: string;
      meetingPlace?: string;
      responseDate?: string;
      negotiationStatus?: string;
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
        negotiationStatus: body.negotiationStatus,
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
