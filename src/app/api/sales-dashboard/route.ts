import { NextResponse } from "next/server";

import { pocketErrorResponse } from "@/lib/api-error-response";

import {
  apiKeyForSalesDashboardPtPocket,
  isPocketHttpRateLimitError,
  pocketApiRateLimitRemainingMs,
} from "@/lib/atpocket";
import { customerInfoConfigReady } from "@/lib/customer-info-config";
import {
  FISCAL_ANNUAL_MONTH_KEY,
  buildFiscalYearOptions,
  currentFiscalYear,
  currentYmInJst,
  fiscalYearMonths,
  parseFiscalMonthParam,
  parseFiscalYearParam,
  type FiscalMonthSelection,
} from "@/lib/fiscal-year";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { tryConsumeManualRefresh } from "@/lib/manual-refresh-throttle";
import type {
  SalesDashboardCore,
  SalesDashboardPayload,
  SalesDashboardSelection,
} from "@/lib/sales-dashboard-data";
import { buildSalesDashboardPayload } from "@/lib/sales-dashboard-data";
import { personalizeSalesDashboardPayload } from "@/lib/sales-dashboard-personalize";
import {
  getAnyStaleSalesDashboardCore,
  getOrComputeSalesDashboardCore,
  getStaleSalesDashboardCore,
} from "@/lib/sales-dashboard-response-cache";
import { parseSalesDashboardPeriodParam } from "@/lib/sales-dashboard-period";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

/**
 * ホームのカード用に、**自分の1行だけ**へ絞った応答。
 *
 * 全量には全社員のランキングとPT明細（お客様名を含む）が入っていて、
 * 順位を出すだけのホームには重い。集計もキャッシュも触らず、
 * personalize 済みの結果から必要な項目だけを取り出して返す。
 *
 * 自分がランキングに居ないときは rank を null にし、値は 0 で返す
 * （呼び出し側は順位の表示だけを省く）。
 */
function selfSummaryResponse(
  payload: SalesDashboardPayload,
  /**
   * 429 で古い集計を返したときの目印。**古い順位を最新として見せない**ため、
   * 絞った応答でも落とさない（文言 rosterMessage はホームで使わないので除く）。
   */
  extra?: { rateLimited: true; dashboardStale: true },
): NextResponse {
  const self = payload.ranking.find((r) => r.isSelf);
  return NextResponse.json({
    rank: self?.rank ?? null,
    totalCount: payload.ranking.length,
    pt: self?.pt ?? 0,
    targetPt: self?.targetPt ?? 0,
    achievementRate: self?.achievementRate ?? 0,
    periodLabel: payload.periodLabel,
    ...(extra ?? {}),
  });
}

/**
 * 期間の指定を解釈する。**値は allowlist でしか通さない。**
 *
 * ■ 新しい指定（fy / month）
 *   fy    … 今年度・前年度の2つだけ。それ以外は今年度へ落とす
 *   month … その年度に属する12ヶ月か "annual" だけ。それ以外は年間へ落とす
 *   任意の年月を渡して過去を無制限に集計させない。
 *
 * ■ 旧クエリ（period=current|previous）
 * 画面をまだ差し替えていないので受け続ける。当月・前月の年月へ翻訳して
 * 同じ経路へ流す。**fy か month が指定されていればそちらを優先する。**
 */
function resolveSelection(url: URL): SalesDashboardSelection {
  const nowMs = Date.now();
  const rawFy = url.searchParams.get("fy");
  const rawMonth = url.searchParams.get("month");
  const rawPeriod = url.searchParams.get("period");

  const fiscalYearOptions = buildFiscalYearOptions(nowMs).map((o) => ({
    key: o.key,
    label: o.label,
  }));

  if (rawFy === null && rawMonth === null && rawPeriod !== null) {
    return legacySelection(rawPeriod, fiscalYearOptions, nowMs);
  }

  const fiscalYear = parseFiscalYearParam(rawFy, nowMs);
  return {
    fiscalYear,
    fiscalYearOptions,
    month: parseFiscalMonthParam(rawMonth, fiscalYear.startYear, nowMs),
    legacyPeriod: "current",
  };
}

/** 旧クエリ用。current=当月・previous=前月を、その月が属する年度で見る */
function legacySelection(
  rawPeriod: string,
  fiscalYearOptions: Array<{ key: string; label: string }>,
  nowMs: number,
): SalesDashboardSelection {
  const legacyPeriod = parseSalesDashboardPeriodParam(rawPeriod);
  const [nowYear, nowMonth] = currentYmInJst(nowMs).split("-").map(Number);
  const zeroBased =
    (nowYear ?? 0) * 12 + ((nowMonth ?? 1) - 1) -
    (legacyPeriod === "previous" ? 1 : 0);
  const year = Math.floor(zeroBased / 12);
  const month1 = (zeroBased % 12) + 1;

  const startYear =
    month1 >= 3 ? year : year - 1;
  const fiscalYear =
    fiscalYearOptions.find((o) => o.key === String(startYear)) ??
    currentFiscalYear(nowMs);

  const target = fiscalYearMonths(Number(fiscalYear.key)).find(
    (m) => m.year === year && m.month1 === month1,
  );
  const month: FiscalMonthSelection = target
    ? {
        kind: "month",
        ym: target.ym,
        year: target.year,
        month1: target.month1,
        label: `${target.year}年${target.month1}月`,
      }
    : { kind: "annual", ym: FISCAL_ANNUAL_MONTH_KEY, label: "年間" };

  return {
    fiscalYear: {
      key: fiscalYear.key,
      label: fiscalYear.label,
      startYear: Number(fiscalYear.key),
    },
    fiscalYearOptions,
    month,
    legacyPeriod,
  };
}

function toPayload(
  core: SalesDashboardCore,
  boundStaffName: string,
  selection: SalesDashboardSelection,
): SalesDashboardPayload {
  return personalizeSalesDashboardPayload(
    buildSalesDashboardPayload(core, boundStaffName, selection),
    boundStaffName,
  );
}

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
  const selection = resolveSelection(url);
  /**
   * 応答を自分の1行に絞るか。**許可値は "self" だけ**で、未指定・未知の値は
   * 従来どおりの全量応答へ落とす（エラーにはしない）。
   * キャッシュは core を共通のまま使い、絞り込みは応答の直前だけで行う。
   */
  const selfOnly = url.searchParams.get("scope") === "self";
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

    const core = await getOrComputeSalesDashboardCore(forceRefresh);
    const payload = core ? toPayload(core, boundStaffName, selection) : null;
    if (!payload) {
      return NextResponse.json(
        {
          error:
            "営業ランキングの集計に失敗しました（SALES_DASHBOARD_PT_APP_ID 等を確認してください）",
        },
        { status: 502 },
      );
    }

    if (selfOnly) return selfSummaryResponse(payload);

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
        getStaleSalesDashboardCore() ?? getAnyStaleSalesDashboardCore();
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
        const payload = toPayload(stale, boundStaffName, selection);
        if (selfOnly) {
          return selfSummaryResponse(payload, {
            rateLimited: true,
            dashboardStale: true,
          });
        }
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
      message: "営業ランキングの取得に失敗しました",
    });
  }
}
