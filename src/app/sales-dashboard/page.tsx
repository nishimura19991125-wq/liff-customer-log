"use client";

import { useCallback, useEffect, useState } from "react";

import {
  SalesDashboardCyberView,
  type DashboardDepartment,
  type DashboardPayload,
  type DashboardPeriod,
} from "@/components/sales-dashboard-cyber-view";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  LiffAccountBar,
  LiffGhostLink,
  LiffLoadingBlock,
  LiffPageHeader,
  LiffScreen,
  LiffSessionExpiredPanel,
  LiffStaffBindPanel,
  LiffStaffBindingConfigNotice,
} from "@/components/liff-chrome";
import { resetLiffScroll } from "@/components/liff-scroll-reset";
import { useLiffAccountStrip } from "@/hooks/use-liff-account-strip";
import { initLiffAndGetToken } from "@/lib/liff-session";
import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

const PERIOD_TABS: Array<{ id: DashboardPeriod; label: string }> = [
  { id: "current", label: "今月" },
  { id: "previous", label: "先月" },
];

export default function SalesDashboardPage() {
  const [phase, setPhase] = useState<
    | "init"
    | "need-login"
    | "loading"
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
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);

  const account = useLiffAccountStrip(idToken, phase === "ready");
  const needsStaffBind =
    account.bindingEnabled &&
    !account.boundStaffName &&
    !account.loading &&
    account.staff.length > 0;

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
        setPhase("loading");
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

  const loadDashboard = useCallback(
    async (token: string, nextPeriod: DashboardPeriod) => {
      setListLoading(true);
      setFeedback(null);
      try {
        const res = await fetch(
          `/api/sales-dashboard?period=${encodeURIComponent(nextPeriod)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const body = (await res.json()) as DashboardPayload & {
          error?: string;
          disabled?: boolean;
          needsStaffBind?: boolean;
        };
        if (isLineSessionExpiredPayload(body)) {
          setPhase("session-expired");
          return;
        }
        if (!res.ok) {
          setFeedback(body.error ?? "ダッシュボードの取得に失敗しました");
          setData(null);
          setPhase("ready");
          return;
        }
        if (body.needsStaffBind) {
          setData(null);
          setPhase("ready");
          return;
        }
        setData(body);
        setPhase("ready");
        resetLiffScroll();
      } catch {
        setFeedback("ダッシュボードの取得に失敗しました");
        setData(null);
        setPhase("ready");
      } finally {
        setListLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!idToken) return;
    if (phase !== "ready" && phase !== "loading") return;
    if (needsStaffBind || account.loading) return;
    void loadDashboard(idToken, period);
  }, [
    phase,
    idToken,
    period,
    needsStaffBind,
    account.loading,
    loadDashboard,
  ]);

  if (
    phase === "init" ||
    phase === "need-login" ||
    (phase === "loading" && !needsStaffBind && !data)
  ) {
    return (
      <LiffLoadingBlock
        message={
          phase === "need-login"
            ? "LINE でログインしています"
            : "ダッシュボードを読み込んでいます"
        }
      />
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

      <div className="mb-4">
        <LiffGhostLink href="/">トップ</LiffGhostLink>
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
                  disabled={listLoading}
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

        {listLoading && !data ? (
          <LiffLoadingBlock message="集計中…" />
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
