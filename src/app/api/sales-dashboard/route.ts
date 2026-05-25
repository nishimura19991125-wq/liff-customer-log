import { NextResponse } from "next/server";

import { customerInfoConfigReady } from "@/lib/customer-info-config";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { buildSalesDashboardPayload } from "@/lib/sales-dashboard-data";
import { resolveBoundStaffDashboardContext } from "@/lib/staff-dashboard-role";

export const dynamic = "force-dynamic";

/** 営業ダッシュボード（当月KPI・ランキング） */
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

  try {
    const ctx = await resolveBoundStaffDashboardContext(auth.lineUserId);
    if (!ctx) {
      return NextResponse.json({ needsStaffBind: true });
    }

    const payload = await buildSalesDashboardPayload(
      ctx.staffName,
      ctx.viewMode,
      ctx.roleLabel,
    );
    if (!payload) {
      return NextResponse.json(
        { error: "営業ダッシュボードの集計に失敗しました" },
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
