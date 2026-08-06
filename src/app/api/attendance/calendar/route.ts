import { NextResponse } from "next/server";

import { pocketErrorResponse } from "@/lib/api-error-response";

import { getAttendanceMonthCalendarForLineUser } from "@/lib/attendance-server";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const url = new URL(request.url);
  const yearRaw = Number(url.searchParams.get("year"));
  const monthRaw = Number(url.searchParams.get("month"));
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }),
  );
  const year =
    Number.isFinite(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100
      ? Math.floor(yearRaw)
      : now.getFullYear();
  const month =
    Number.isFinite(monthRaw) && monthRaw >= 1 && monthRaw <= 12
      ? Math.floor(monthRaw)
      : now.getMonth() + 1;

  try {
    const data = await getAttendanceMonthCalendarForLineUser(
      auth.lineUserId,
      year,
      month,
    );
    return NextResponse.json(data);
  } catch (e) {
    return pocketErrorResponse(e, {
      scope: "api/attendance/calendar",
      message: "勤怠カレンダーの取得に失敗しました",
    });
  }
}
