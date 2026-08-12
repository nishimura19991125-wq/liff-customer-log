"use client";

import { useCallback, useEffect, useState } from "react";

import {
  SalesDashboardCyberView,
  type DashboardDepartment,
  type DashboardPayload,
  type DashboardPeriod,
} from "@/components/sales-dashboard-cyber-view";
import { SalesDashboardSkeleton } from "@/components/sales-dashboard-skeleton";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  LiffAccountBar,
  LiffGhostLink,
  LiffPageHeader,
  LiffScreen,
  LiffSessionExpiredPanel,
  LiffStaffBindPanel,
  LiffStaffBindingConfigNotice,
} from "@/components/liff-chrome";
import { resetLiffScroll } from "@/components/liff-scroll-reset";
import { useLiffAccountStrip } from "@/hooks/use-liff-account-strip";
import { useLiffSwr } from "@/hooks/use-liff-swr";
import {
  LIFF_SWR_DASHBOARD_OPTIONS,
  isLiffSwrSessionExpired,
  liffAuthedJsonFetch,
} from "@/lib/liff-swr";
import { initLiffAndGetToken } from "@/lib/liff-session";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

const PERIOD_TABS: Array<{ id: DashboardPeriod; label: string }> = [
  { id: "current", label: "今月" },
  { id: "previous", label: "先月" },
];

export default function SalesDashboardPage() {
  const [phase, setPhase] = useState<
    | "init"
    | "need-login"
    | "ready"
    | "error"
    | "session-expired"
  >(() => (LIFF_ID ? "init" : "error"));
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    LIFF_ID ? null : "NEXT_PUBLIC_LIFF_ID が設定されていません",
  );
  const [idToken, setIdToken] = useState<string | null>(null);
  const [period, setPeriod] = useState<DashboardPeriod>("current");
  const [department, setDepartment] = useState<DashboardDepartment>("pt");
  const [feedback, setFeedback] = useState<string | null>(null);

  const account = useLiffAccountStrip(idToken, phase === "ready");
  const needsStaffBind =
    account.bindingEnabled &&
    !account.boundStaffName &&
    !account.loading &&
    account.staff.length > 0;

  const canFetchDashboard =
    Boolean(idToken) &&
    (!account.bindingEnabled ||
      Boolean(account.boundStaffName) ||
      (!account.loading && account.staff.length === 0));

  useEffect(() => {
    if (!LIFF_ID) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await initLiffAndGetToken(LIFF_ID);
        if (cancelled) return;
        if (result.status === "redirecting") {
          setPhase("need-login");
          return;
        }
        setIdToken(result.token);
        setPhase("ready");
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        setErrorMessage("LIFF の初期化に失敗しました");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  type DashboardApiBody = DashboardPayload & {
    error?: string;
    disabled?: boolean;
    needsStaffBind?: boolean;
    rateLimited?: boolean;
    dashboardStale?: boolean;
    rosterMessage?: string;
    /** 「更新」が間隔制限で見送られた（タスクO-2） */
    refreshThrottled?: boolean;
    refreshRetryAfterSec?: number;
  };

  const dashboardPath = canFetchDashboard
    ? `/api/sales-dashboard?period=${encodeURIComponent(period)}`
    : null;

  const {
    data,
    error: swrError,
    isLoading: dashboardLoading,
    isValidating,
    mutate,
  } = useLiffSwr<DashboardApiBody>(dashboardPath, idToken, LIFF_SWR_DASHBOARD_OPTIONS);

  /**
   * 集計のキャッシュを無視して取り直す（タスクO-2）。
   * TTL を30分に伸ばしたぶん、最新が要るときの手段を用意する。
   * サーバ側で同一利用者60秒に1回へ絞っているので、連打しても
   * @pocket は叩かれない（refreshThrottled が返る）。
   */
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");

  const handleRefresh = useCallback(async () => {
    if (!idToken || !dashboardPath || refreshing) return;
    setRefreshing(true);
    setRefreshMessage("");
    try {
      const sep = dashboardPath.includes("?") ? "&" : "?";
      const fresh = await liffAuthedJsonFetch<DashboardApiBody>(
        `${dashboardPath}${sep}refresh=1`,
        idToken,
      );
      await mutate(fresh, { revalidate: false });
      setRefreshMessage(
        fresh.refreshThrottled
          ? `更新は${fresh.refreshRetryAfterSec ?? 60}秒後に再度お試しください（表示は最新の集計です）`
          : "最新の集計を取得しました",
      );
    } catch {
      setRefreshMessage("更新に失敗しました");
    } finally {
      setRefreshing(false);
    }
  }, [idToken, dashboardPath, refreshing, mutate]);

  useEffect(() => {
    if (!idToken || phase !== "ready") return;
    if (swrError) {
      if (isLiffSwrSessionExpired(swrError)) {
        setPhase("session-expired");
        return;
      }
      if (swrError.status === 429) {
        setFeedback(
          swrError.message ||
            "データ取得の利用上限に達しました。1〜2分待ってから再度お試しください。",
        );
        return;
      }
      setFeedback(swrError.message);
      return;
    }
    if (data) {
      if (data.rosterMessage?.trim()) {
        setFeedback(data.rosterMessage.trim());
      } else if (data.rateLimited || data.dashboardStale) {
        setFeedback(
          "データ取得の利用上限に達したため、直近の集計結果を表示しています。1〜2分後に再度お試しください。",
        );
      } else {
        setFeedback(null);
      }
      resetLiffScroll();
    }
  }, [idToken, phase, data, swrError]);

  const showDashboardSkeleton =
    canFetchDashboard && !data && (dashboardLoading || isValidating);

  if (phase === "init") {
    return (
      <LiffScreen>
        <SalesDashboardSkeleton />
      </LiffScreen>
    );
  }

  if (phase === "need-login") {
    return (
      <LiffScreen>
        <p className="py-10 text-center text-[14px] text-slate-600">
          LINE でログインしています…
        </p>
      </LiffScreen>
    );
  }

  if (phase === "error") {
    return (
      <LiffScreen>
        <div className="flex flex-1 flex-col justify-center py-10">
          <div className="cyber-card px-5 py-8 text-center">
            <p className="text-[15px] leading-relaxed text-red-700 dark:text-red-400 whitespace-pre-wrap">
              {errorMessage}
            </p>
          </div>
        </div>
      </LiffScreen>
    );
  }

  if (phase === "session-expired") {
    return <LiffSessionExpiredPanel />;
  }

  return (
    <LiffScreen>
      <LiffPageHeader
        title="営業ダッシュボード"
        titleClassName="text-base font-bold leading-tight tracking-tight whitespace-nowrap text-slate-900 sm:text-lg dark:text-white"
        subtitle="PTを軸にした全社ランキング"
        subtitleClassName="mt-0.5 truncate text-[12px] leading-snug text-slate-500 sm:text-[13px] dark:text-slate-400"
        action={
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={refreshing || !dashboardPath}
              className="rounded-lg px-2 py-1 text-[13px] font-medium text-sky-700 active:bg-sky-50 disabled:opacity-50 dark:text-sky-300 dark:active:bg-sky-950/40"
            >
              {refreshing ? "更新中…" : "更新"}
            </button>
            <ThemeToggle />
            <LiffAccountBar
              loading={account.loading}
              pictureUrl={account.pictureUrl}
              boundStaffName={account.boundStaffName}
              bindingEnabled={account.bindingEnabled}
            />
          </div>
        }
      />

      {/* 「更新」の結果。要素は出し入れせず読み上げの取りこぼしを防ぐ */}
      <p
        role="status"
        aria-live="polite"
        className={
          refreshMessage
            ? "mb-2 text-[12px] font-bold text-slate-600 dark:text-slate-300"
            : "sr-only"
        }
      >
        {refreshMessage}
      </p>

      <div className="mb-4">
        <LiffGhostLink href="/">メニューへ</LiffGhostLink>
      </div>

      {account.boundStaffName && !needsStaffBind ? (
        <p className="mb-4 text-[15px] font-semibold text-slate-800 dark:text-emerald-50/90">
          {account.boundStaffName} さんの成績
        </p>
      ) : null}

      <LiffStaffBindingConfigNotice message={account.bindingConfigError} />
      <LiffStaffBindPanel
        staff={account.staff}
        bindingEnabled={account.bindingEnabled}
        boundStaffName={account.boundStaffName}
        accountLoading={account.loading}
        onBind={account.bindStaff}
      />

      <div
        className={
          needsStaffBind
            ? "pointer-events-none opacity-[0.35] saturate-50"
            : undefined
        }
      >
        <div className="relative mb-4">
          <nav
            className="flex gap-2 overflow-x-auto pb-2 pr-4 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="対象期間"
          >
            {PERIOD_TABS.map((tab) => {
              const active = period === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPeriod(tab.id)}
                  disabled={showDashboardSkeleton && active}
                  className={`shrink-0 rounded-2xl px-5 py-2.5 text-[15px] transition-all duration-300 active:scale-[0.98] disabled:opacity-60 ${
                    active
                      ? "cyber-tab-active"
                      : "bg-slate-100 font-semibold text-slate-600 dark:bg-slate-800/80 dark:text-slate-400"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {feedback ? (
          <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200 dark:shadow-[0_0_12px_rgba(239,68,68,0.12)]">
            {feedback}
          </p>
        ) : null}

        {showDashboardSkeleton ? (
          <SalesDashboardSkeleton />
        ) : data ? (
          <SalesDashboardCyberView
            data={data}
            department={department}
            onDepartmentChange={setDepartment}
          />
        ) : needsStaffBind ? null : (
          <p className="mt-6 text-center text-[13px] text-slate-500 dark:text-slate-400">
            データを表示できませんでした
          </p>
        )}
      </div>
    </LiffScreen>
  );
}
