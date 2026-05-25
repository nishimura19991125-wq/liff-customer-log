"use client";

import { useCallback, useEffect, useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import {
  LiffAccountBar,
  LiffCard,
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

type DashboardPeriod = "current" | "previous";

type DashboardKpi = {
  pt: number;
  salesAmount: number;
  contractCount: number;
  avgAmount: number;
};

type RankingRow = {
  rank: number;
  staffName: string;
  pt: number;
  salesAmount: number;
  contractCount: number;
  sharePercent: number;
  isSelf: boolean;
  isPodium: boolean;
};

type DashboardPayload = {
  staffName: string;
  period: DashboardPeriod;
  periodLabel: string;
  periodHint: string;
  kpi: DashboardKpi;
  ranking: RankingRow[];
};

const PERIOD_TABS: Array<{ id: DashboardPeriod; label: string }> = [
  { id: "current", label: "今月" },
  { id: "previous", label: "先月" },
];

function formatYen(n: number): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatPt(n: number): string {
  return new Intl.NumberFormat("ja-JP").format(Math.round(n));
}

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
          <LiffCard>
            <div className="px-5 py-8 text-center">
              <p className="text-[15px] leading-relaxed text-red-700 dark:text-red-400 whitespace-pre-wrap">
                {errorMessage}
              </p>
            </div>
          </LiffCard>
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
        subtitle="全社の売上KPIと営業ランキング"
        action={
          <div className="flex shrink-0 items-center gap-2">
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
                      ? "bg-emerald-600 font-bold text-white shadow-md shadow-emerald-600/25"
                      : "bg-slate-100 font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {feedback ? (
          <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-800 dark:bg-red-950/40 dark:text-red-200">
            {feedback}
          </p>
        ) : null}

        {listLoading && !data ? (
          <LiffLoadingBlock message="集計中…" />
        ) : data ? (
          <div className="flex flex-col gap-5">
            <p className="text-[13px] text-slate-500 dark:text-slate-400">
              {data.periodLabel}（JST）· {data.periodHint}
            </p>

            <section className="grid grid-cols-1 gap-3">
              <LiffCard>
                <div className="p-5">
                  <p className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
                    全社 PT（粗利）
                  </p>
                  <p className="mt-1 text-[2rem] font-black leading-none tracking-tight text-slate-800 dark:text-white">
                    {formatPt(data.kpi.pt)}
                    <span className="ml-2 text-[1rem] font-bold text-emerald-600 dark:text-emerald-400">
                      pt
                    </span>
                  </p>
                </div>
              </LiffCard>
              <div className="grid grid-cols-2 gap-3">
                <LiffCard>
                  <div className="p-4">
                    <p className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
                      全社売上
                    </p>
                    <p className="mt-1 text-[1.2rem] font-bold text-slate-800 dark:text-white">
                      {formatYen(data.kpi.salesAmount)}
                    </p>
                  </div>
                </LiffCard>
                <LiffCard>
                  <div className="p-4">
                    <p className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
                      契約件数
                    </p>
                    <p className="mt-1 text-[1.2rem] font-bold text-slate-800 dark:text-white">
                      {data.kpi.contractCount}
                      <span className="ml-1 text-[14px] font-semibold text-slate-500">
                        件
                      </span>
                    </p>
                  </div>
                </LiffCard>
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-[15px] font-bold text-slate-800 dark:text-white">
                営業成績ランキング
              </h2>
              <div className="flex flex-col gap-2">
                {data.ranking.length === 0 ? (
                  <LiffCard>
                    <p className="px-4 py-6 text-center text-[13px] text-slate-500 dark:text-slate-400">
                      対象期間のデータがありません
                    </p>
                  </LiffCard>
                ) : (
                  data.ranking.map((row) => (
                    <LiffCard key={`${row.rank}-${row.staffName}`}>
                      <div
                        className={`px-4 py-3 transition-all duration-300 ${
                          row.isSelf
                            ? "ring-2 ring-inset ring-blue-200/80 dark:ring-blue-500/40"
                            : ""
                        } ${row.isPodium ? "bg-gradient-to-r from-amber-50/80 to-transparent dark:from-amber-950/30" : ""}`}
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={`flex size-9 shrink-0 items-center justify-center rounded-full text-[14px] font-bold ${
                              row.rank === 1
                                ? "bg-amber-400 text-amber-950"
                                : row.rank === 2
                                  ? "bg-slate-300 text-slate-800 dark:bg-slate-500 dark:text-white"
                                  : row.rank === 3
                                    ? "bg-amber-700/80 text-white"
                                    : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200"
                            }`}
                          >
                            {row.rank}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[14px] font-semibold text-slate-800 dark:text-white">
                              {row.staffName}
                              {row.isSelf ? (
                                <span className="ml-2 text-[11px] font-medium text-blue-600 dark:text-blue-400">
                                  あなた
                                </span>
                              ) : null}
                            </p>
                            <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">
                              {formatPt(row.pt)} pt · {row.contractCount}件 ·{" "}
                              {formatYen(row.salesAmount)}
                            </p>
                            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                              <div
                                className="h-full rounded-full bg-emerald-500 transition-all duration-300 dark:bg-emerald-400"
                                style={{
                                  width: `${Math.max(2, Math.min(100, row.sharePercent))}%`,
                                }}
                              />
                            </div>
                            <p className="mt-1 text-[11px] text-slate-400">
                              PT比率 {row.sharePercent}%
                            </p>
                          </div>
                        </div>
                      </div>
                    </LiffCard>
                  ))
                )}
              </div>
            </section>
          </div>
        ) : needsStaffBind ? null : (
          <p className="mt-6 text-center text-[13px] text-slate-500 dark:text-slate-400">
            データを表示できませんでした
          </p>
        )}
      </div>
    </LiffScreen>
  );
}
