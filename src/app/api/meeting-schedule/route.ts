import { NextResponse } from "next/server";

import { customerInfoConfigReady } from "@/lib/customer-info-config";
import {
  buildMeetingScheduleClosedListForStaff,
  buildMeetingScheduleForStaff,
  buildMeetingScheduleListForStaff,
} from "@/lib/meeting-schedule";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

/** 担当者別・日付別の商談進捗情報一覧 */
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

  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const scope = url.searchParams.get("scope");

  try {
    const boundStaffName = await resolveBoundStaffNameForLineUser(
      auth.lineUserId,
    );
    if (!boundStaffName) {
      return NextResponse.json({ needsStaffBind: true });
    }

    const payload =
      scope === "list"
        ? await buildMeetingScheduleListForStaff(boundStaffName)
        : scope === "closed"
          ? await buildMeetingScheduleClosedListForStaff(boundStaffName)
          : await buildMeetingScheduleForStaff(boundStaffName, date);
    return NextResponse.json(payload);
  } catch (e) {
    console.error("[api/meeting-schedule]", e);
    const msg =
      e instanceof Error ? e.message : "商談進捗情報の取得に失敗しました";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
