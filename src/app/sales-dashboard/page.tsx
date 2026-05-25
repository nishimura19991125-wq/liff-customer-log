"use client";

import { useCallback, useEffect, useState } from "react";

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

type DashboardKpi = {
  salesAmount: number;
  contractCount: number;
  avgAmount: number;
};

type RankingRow = {
  rank: number;
  staffName: string;
  salesAmount: number;
  contractCount: number;
  isSelf: boolean;
};

type DashboardPayload = {
  staffName: string;
  periodLabel: string;
  kpi: DashboardKpi;
  ranking: RankingRow[];
};

function formatYen(n: number): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(n);
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
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

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

  const loadDashboard = useCallback(async (token: string) => {
    setFeedback(null);
    try {
      const res = await fetch("/api/sales-dashboard", {
        headers: { Authorization: `Bearer ${token}` },
      });
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
    }
  }, []);

  useEffect(() => {
    if (phase !== "loading" || !idToken || needsStaffBind || account.loading) {
      return;
    }
    void loadDashboard(idToken);
  }, [phase, idToken, needsStaffBind, account.loading, loadDashboard]);

  if (
    phase === "init" ||
    phase === "need-login" ||
    (phase === "loading" && !needsStaffBind)
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
              <p className="text-[15px] leading-relaxed text-red-700 whitespace-pre-wrap">
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
        subtitle="全社の当月売上KPIと営業ランキング"
        action={<LiffGhostLink href="/">トップ</LiffGhostLink>}
      />

      <LiffAccountBar
        loading={account.loading}
        pictureUrl={account.pictureUrl}
        boundStaffName={account.boundStaffName}
        bindingEnabled={account.bindingEnabled}
      />

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

        {feedback ? (
          <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-800">
            {feedback}
          </p>
        ) : null}

        {data ? (
          <div className="mt-6 flex flex-col gap-5">
            <p className="text-[13px] text-slate-500">
              {data.periodLabel}（JST）
            </p>

            <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <LiffCard>
                <div className="p-4">
                  <p className="text-[12px] font-medium text-slate-500">
                    全社売上
                  </p>
                  <p className="mt-1 text-[1.35rem] font-bold text-slate-900">
                    {formatYen(data.kpi.salesAmount)}
                  </p>
                </div>
              </LiffCard>
              <LiffCard>
                <div className="p-4">
                  <p className="text-[12px] font-medium text-slate-500">
                    契約件数
                  </p>
                  <p className="mt-1 text-[1.35rem] font-bold text-slate-900">
                    {data.kpi.contractCount}
                    <span className="ml-1 text-[14px] font-semibold text-slate-500">
                      件
                    </span>
                  </p>
                </div>
              </LiffCard>
              <LiffCard>
                <div className="p-4">
                  <p className="text-[12px] font-medium text-slate-500">
                    平均単価
                  </p>
                  <p className="mt-1 text-[1.35rem] font-bold text-slate-900">
                    {formatYen(data.kpi.avgAmount)}
                  </p>
                </div>
              </LiffCard>
            </section>

            <section>
              <h2 className="mb-3 text-[15px] font-bold text-slate-800">
                営業成績ランキング
              </h2>
              <div className="flex flex-col gap-2">
                {data.ranking.length === 0 ? (
                  <LiffCard>
                    <p className="px-4 py-6 text-center text-[13px] text-slate-500">
                      当月の契約データがありません
                    </p>
                  </LiffCard>
                ) : (
                  data.ranking.map((row) => (
                    <LiffCard key={`${row.rank}-${row.staffName}`}>
                      <div
                        className={`flex items-center gap-3 px-4 py-3 ${
                          row.isSelf ? "ring-2 ring-inset ring-blue-200/80" : ""
                        }`}
                      >
                        <span
                          className={`flex size-9 shrink-0 items-center justify-center rounded-full text-[14px] font-bold ${
                            row.rank <= 3
                              ? "bg-blue-500 text-white"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {row.rank}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-semibold text-slate-900">
                            {row.staffName}
                            {row.isSelf ? (
                              <span className="ml-2 text-[11px] font-medium text-blue-600">
                                あなた
                              </span>
                            ) : null}
                          </p>
                          <p className="text-[12px] text-slate-500">
                            {row.contractCount}件 ·{" "}
                            {formatYen(row.salesAmount)}
                          </p>
                        </div>
                      </div>
                    </LiffCard>
                  ))
                )}
              </div>
            </section>
          </div>
        ) : needsStaffBind ? null : (
          <p className="mt-6 text-center text-[13px] text-slate-500">
            データを表示できませんでした
          </p>
        )}
      </div>
    </LiffScreen>
  );
}
