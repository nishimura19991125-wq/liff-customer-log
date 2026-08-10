import { NextResponse } from "next/server";

import { pocketErrorResponse } from "@/lib/api-error-response";

import { isPocketHttpRateLimitError } from "@/lib/atpocket";
import { customerInfoConfigReady } from "@/lib/customer-info-config";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import {
  pickSelfSalesProgress,
  type SalesProgressGroupRow,
  type SalesProgressMetrics,
} from "@/lib/sales-progress-aggregate";
import {
  buildSalesProgressMonthOptions,
  parseSalesProgressMonthParam,
} from "@/lib/sales-progress-period";
import { getOrComputeSalesProgressCore } from "@/lib/sales-progress-response-cache";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

/**
 * 営業進捗（目標に対する達成率・タスクK）。
 *
 * 既存の GET /api/sales-dashboard とは別のルート。既存側は変更していない。
 *
 * ■ 返すもの（K-3）
 * 本人の数字・全社の合計・支社別の集計値だけ。
 * **他人の氏名も、個人別の数値も返さない。** 本人分の抽出はここで行い、
 * クライアント側のフィルタには頼らない。
 */

export type SalesProgressPayload = {
  staffName: string;
  ym: string;
  monthLabel: string;
  monthOptions: Array<{ ym: string; label: string }>;
  self: SalesProgressMetrics;
  /** 対象月の本人の目標が登録されていない */
  selfTargetMissing: boolean;
  company: SalesProgressMetrics;
  branches: Array<{
    label: string;
    memberCount: number;
    metrics: SalesProgressMetrics;
  }>;
  /** 目標が1件も取れなかった月 */
  targetsAvailable: boolean;
  needsStaffBind?: boolean;
};

function toBranchPayload(rows: SalesProgressGroupRow[]) {
  // 集計値と人数だけ。氏名は元から持っていない
  return rows.map((r) => ({
    label: r.label,
    memberCount: r.memberCount,
    metrics: r.metrics,
  }));
}

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
  const month = parseSalesProgressMonthParam(url.searchParams.get("month"));
  const monthOptions = buildSalesProgressMonthOptions().map((m) => ({
    ym: m.ym,
    label: m.label,
  }));

  try {
    const boundStaffName = await resolveBoundStaffNameForLineUser(
      auth.lineUserId,
    );
    if (!boundStaffName) {
      return NextResponse.json(
        { needsStaffBind: true, error: "スタッフ名簿への紐付けが必要です" },
        { status: 403 },
      );
    }

    const core = await getOrComputeSalesProgressCore(month);
    if (!core) {
      return NextResponse.json(
        {
          error:
            "営業進捗の集計に失敗しました（SALES_TARGET_APP_ID・SALES_DASHBOARD_PT_APP_ID 等を確認してください）",
        },
        { status: 502 },
      );
    }

    // 本人分の抽出はここで行う。core（担当者別の行を含む）は外へ出さない
    const self = pickSelfSalesProgress(
      core.targets,
      core.actuals,
      normApClStaffName(boundStaffName),
    );

    const payload: SalesProgressPayload = {
      staffName: boundStaffName,
      ym: core.ym,
      monthLabel: core.monthLabel,
      monthOptions,
      self: self.metrics,
      selfTargetMissing: self.targetMissing,
      company: core.company,
      branches: toBranchPayload(core.branches),
      targetsAvailable: core.targetsAvailable,
    };
    return NextResponse.json(payload);
  } catch (e) {
    console.error("[api/sales-progress]", e);
    if (isPocketHttpRateLimitError(e)) {
      return NextResponse.json(
        {
          error:
            "データ取得の利用上限に達しました。1〜2分待ってから再度お試しください。",
        },
        { status: 429, headers: { "Retry-After": "90" } },
      );
    }
    return pocketErrorResponse(e, {
      scope: "api/sales-progress",
      message: "営業進捗の取得に失敗しました",
    });
  }
}
