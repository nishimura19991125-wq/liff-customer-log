import { NextResponse } from "next/server";

import { pocketErrorResponse } from "@/lib/api-error-response";

import {
  apiKeyForSalesDashboardPtPocket,
  isPocketHttpRateLimitError,
  pocketApiRateLimitRemainingMs,
} from "@/lib/atpocket";
import { customerInfoConfigReady } from "@/lib/customer-info-config";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { tryConsumeManualRefresh } from "@/lib/manual-refresh-throttle";
import { personalizeSalesDashboardPayload } from "@/lib/sales-dashboard-personalize";
import {
  getAnyStaleSalesDashboardCore,
  getOrComputeSalesDashboardCore,
  getStaleSalesDashboardCore,
} from "@/lib/sales-dashboard-response-cache";
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
  // 画面の「更新」。連打で @pocket を叩き続けないよう同一利用者は60秒に1回
  const wantsRefresh = url.searchParams.get("refresh") === "1";
  const refreshDecision = wantsRefresh
    ? tryConsumeManualRefresh("sales-dashboard", auth.lineUserId)
    : ({ allowed: false } as const);
  const forceRefresh = wantsRefresh && refreshDecision.allowed;

  try {
    const boundStaffName = await resolveBoundStaffNameForLineUser(
      auth.lineUserId,
    );
    if (!boundStaffName) {
      return NextResponse.json({ needsStaffBind: true });
    }

    const core = await getOrComputeSalesDashboardCore(period, forceRefresh);
    const payload = core
      ? personalizeSalesDashboardPayload(core, boundStaffName)
      : null;
    if (!payload) {
      return NextResponse.json(
        {
          error:
            "営業ダッシュボードの集計に失敗しました（SALES_DASHBOARD_PT_APP_ID 等を確認してください）",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ...payload,
      // 「更新」を押したが間隔制限で見送った場合に画面へ知らせる
      ...(wantsRefresh && !forceRefresh
        ? {
            refreshThrottled: true,
            refreshRetryAfterSec:
              "retryAfterSec" in refreshDecision
                ? refreshDecision.retryAfterSec
                : 60,
          }
        : {}),
    });
  } catch (e) {
    console.error("[api/sales-dashboard]", e);
    if (isPocketHttpRateLimitError(e)) {
      const stale =
        getStaleSalesDashboardCore(period) ??
        getAnyStaleSalesDashboardCore();
      const retrySec = Math.max(
        60,
        Math.ceil(
          pocketApiRateLimitRemainingMs({
            apiKey: apiKeyForSalesDashboardPtPocket(),
          }) / 1000,
        ) || 90,
      );
      if (stale) {
        const boundStaffName = await resolveBoundStaffNameForLineUser(
          auth.lineUserId,
        );
        if (!boundStaffName) {
          return NextResponse.json({ needsStaffBind: true });
        }
        const payload = personalizeSalesDashboardPayload(stale, boundStaffName);
        return NextResponse.json({
          ...payload,
          rateLimited: true,
          dashboardStale: true,
          rosterMessage:
            "データ取得の利用上限に達したため、直近の集計結果を表示しています。1〜2分後に再度お試しください。",
        });
      }
      return NextResponse.json(
        {
          error:
            "データ取得の利用上限に達しました。1〜2分待ってから再度お試しください。",
        },
        { status: 429, headers: { "Retry-After": String(retrySec) } },
      );
    }
    return pocketErrorResponse(e, {
      scope: "api/sales-dashboard",
      message: "営業ダッシュボードの取得に失敗しました",
    });
  }
}
