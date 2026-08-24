import { NextResponse } from "next/server";

import { pocketErrorResponse } from "@/lib/api-error-response";

import { customerInfoConfigReady } from "@/lib/customer-info-config";
import { updateMeetingScheduleScheduledForStaff } from "@/lib/meeting-schedule";
import {
  isMeetingScheduleFieldLocked,
  meetingScheduleLockedFieldMessage,
} from "@/lib/meeting-schedule-locked-fields";
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

  /**
   * 商談・資料送付予定日時は LIFF から変更できない（@pocket 側で変更する）。
   * 画面から入力欄を消しても、古いキャッシュの画面や API の直叩きで
   * 書き込めてしまうため、サーバ側でも塞ぐ。
   *
   * このルートは日時しか運んでいないので、拒否しても他項目の保存を
   * 巻き込まない。黙って無視すると画面に「保存しました」と出て実際は
   * 保存されない嘘の成功になるため、明示的に 403 で返す。
   * （見積ステータス側は付随項目と同居しているので payload から落とす方式）
   */
  if (isMeetingScheduleFieldLocked("scheduledDateTime")) {
    return NextResponse.json(
      { error: meetingScheduleLockedFieldMessage("scheduledDateTime") },
      { status: 403 },
    );
  }

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
