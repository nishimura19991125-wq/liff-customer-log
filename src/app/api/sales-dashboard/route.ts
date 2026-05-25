import { NextResponse } from "next/server";

import { customerInfoConfigReady } from "@/lib/customer-info-config";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { buildSalesDashboardPayload } from "@/lib/sales-dashboard-data";
import { parseSalesDashboardPeriodParam } from "@/lib/sales-dashboard-period";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

/** 営業ダッシュボード（PT集計・全社員共通） */
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
  const period = parseSalesDashboardPeriodParam(url.searchParams.get("period"));

  try {
    const boundStaffName = await resolveBoundStaffNameForLineUser(
      auth.lineUserId,
    );
    if (!boundStaffName) {
      return NextResponse.json({ needsStaffBind: true });
    }

    const payload = await buildSalesDashboardPayload(boundStaffName, period);
    if (!payload) {
      return NextResponse.json(
        {
          error:
            "営業ダッシュボードの集計に失敗しました（SALES_DASHBOARD_PT_APP_ID 等を確認してください）",
        },
        { status: 502 },
      );
    }

    return NextResponse.json(payload);
  } catch (e) {
    console.error("[api/sales-dashboard]", e);
    const msg =
      e instanceof Error ? e.message : "営業ダッシュボードの取得に失敗しました";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
