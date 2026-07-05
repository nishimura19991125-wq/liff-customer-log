import { NextResponse } from "next/server";

import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import {
  getWorkEndReportStatusForLineUser,
  submitWorkEndReportForLineUser,
} from "@/lib/work-end-report-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  try {
    const status = await getWorkEndReportStatusForLineUser(auth.lineUserId);
    return NextResponse.json(status);
  } catch (e) {
    console.error("[api/work-end-report GET]", e);
    const msg =
      e instanceof Error ? e.message : "稼働終了報告の取得に失敗しました";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  let body: {
    pinponCount?: string;
    meetingCount?: string;
    apoCount?: string;
    apoActivity?: string;
    workArea?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await submitWorkEndReportForLineUser(auth.lineUserId, {
      pinponCount: body.pinponCount ?? "",
      meetingCount: body.meetingCount ?? "",
      apoCount: body.apoCount ?? "",
      apoActivity: body.apoActivity ?? "",
      workArea: body.workArea ?? "",
    });
    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          ...(result.needsStaffBind ? { needsStaffBind: true } : {}),
        },
        { status: result.status },
      );
    }
    return NextResponse.json(result.status);
  } catch (e) {
    console.error("[api/work-end-report POST]", e);
    const msg =
      e instanceof Error ? e.message : "稼働終了報告の送信に失敗しました";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
