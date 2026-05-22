import { NextResponse } from "next/server";

import { customerInfoConfigReady } from "@/lib/customer-info-config";
import { findCustomerInfoPendingRecords } from "@/lib/customer-info-continue-shortcut";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

/** 入力ステータス「未入力」の案件一覧（AP/CL担当一致、または作成者向け） */
export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const cfg = customerInfoConfigReady();
  if (!cfg.ok) {
    return NextResponse.json(
      { records: [], disabled: true, error: cfg.error },
      { status: 503 },
    );
  }

  try {
    const boundStaffName = await resolveBoundStaffNameForLineUser(
      auth.lineUserId,
    );
    if (!boundStaffName) {
      return NextResponse.json({ records: [] });
    }

    const records = await findCustomerInfoPendingRecords(boundStaffName);
    return NextResponse.json({ records });
  } catch (e) {
    console.error("[api/customer-info/pending-records]", e);
    const msg =
      e instanceof Error ? e.message : "未入力案件の取得に失敗しました";
    return NextResponse.json({ error: msg, records: [] }, { status: 502 });
  }
}
