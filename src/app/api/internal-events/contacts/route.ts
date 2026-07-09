import { NextResponse } from "next/server";

import { DEFAULT_STAFF_CONTACTS_DEPARTMENT_ORDER, fetchStaffContactsByDepartment } from "@/lib/staff-contacts-directory";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  try {
    const result = await fetchStaffContactsByDepartment(
      DEFAULT_STAFF_CONTACTS_DEPARTMENT_ORDER,
    );
    if (!result.ok) {
      return NextResponse.json(
        { configured: false, error: result.error, groups: [] },
        { status: 503 },
      );
    }

    return NextResponse.json({
      configured: true,
      groups: result.groups,
    });
  } catch (e) {
    console.error("[api/internal-events/contacts]", e);
    return NextResponse.json(
      {
        configured: false,
        error: "連絡先一覧の取得に失敗しました",
        groups: [],
      },
      { status: 502 },
    );
  }
}
