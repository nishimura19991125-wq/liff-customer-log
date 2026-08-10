"use client";

import { useEffect, useId, useState } from "react";

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
import { SalesProgressBar } from "@/components/sales-progress-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { useLiffAccountStrip } from "@/hooks/use-liff-account-strip";
import { useLiffSwr } from "@/hooks/use-liff-swr";
import { initLiffAndGetToken } from "@/lib/liff-session";
import {
  LIFF_SWR_DASHBOARD_OPTIONS,
  isLiffSwrSessionExpired,
} from "@/lib/liff-swr";
import {
  formatSalesProgressNumber,
  formatSalesProgressRate,
} from "@/lib/sales-progress-aggregate";
import type { SalesProgressPayload } from "@/app/api/sales-progress/route";

/**
 * 営業進捗（目標に対する達成率・タスクK）。
 *
 * 既存の /sales-dashboard とは別の画面。既存側は変更していない。
 * 表示するのは本人の数字・全社の合計・支社別の集計値だけで、
 * 他人の氏名も個人別の数値も受け取らない（サーバ側で落としている）。
 */

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

export default function SalesProgressPage() {
  const [phase, setPhase] = useState<
    "init" | "need-login" | "ready" | "error" | "session-expired"
  >(() => (LIFF_ID ? "init" : "error"));
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    LIFF_ID ? null : "NEXT_PUBLIC_LIFF_ID が設定されていません",
  );
  const [idToken, setIdToken] = useState<string | null>(null);
  const [ym, setYm] = useState("");
  const [branchOpen, setBranchOpen] = useState(false);
  const branchListId = useId();

  const account = useLiffAccountStrip(idToken, phase === "ready");
  const needsStaffBind =
    account.bindingEnabled &&
    !account.boundStaffName &&
    !account.loading &&
    account.staff.length > 0;

  const canFetch =
    Boolean(idToken) &&
    phase === "ready" &&
    !needsStaffBind &&
    !account.loading &&
    Boolean(account.boundStaffName || !account.bindingEnabled);

  const apiPath = canFetch
    ? `/api/sales-progress${ym ? `?month=${encodeURIComponent(ym)}` : ""}`
    : null;

  const { data, error: swrError, isLoading } = useLiffSwr<
    SalesProgressPayload & { error?: string; disabled?: boolean }
  >(apiPath, idToken, LIFF_SWR_DASHBOARD_OPTIONS);

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

  // state に写さず導出する。effect の中で setState すると再描画が連鎖する
  const sessionExpired =
    phase === "session-expired" ||
    Boolean(swrError && isLiffSwrSessionExpired(swrError));

  if (sessionExpired) {
    return (
      <LiffScreen>
        <LiffSessionExpiredPanel />
      </LiffScreen>
    );
  }

  if (phase === "need-login") {
    return (
      <LiffScreen>
        <main className="liff-page-main mx-auto w-full max-w-lg flex-1 py-6">
          <p className="text-center text-sm text-slate-600 dark:text-slate-300">
            LINE ログインへ移動しています…
          </p>
        </main>
      </LiffScreen>
    );
  }

  if (phase === "error") {
    return (
      <LiffScreen>
        <main className="liff-page-main mx-auto w-full max-w-lg flex-1 py-6">
          <p className="text-center text-sm text-red-700 dark:text-red-300">
            {errorMessage}
          </p>
        </main>
      </LiffScreen>
    );
  }

  if (phase === "init") {
    return (
      <LiffScreen>
        <LiffLoadingBlock message="読み込み中…" />
      </LiffScreen>
    );
  }

  const monthOptions = data?.monthOptions ?? [];

  return (
    <LiffScreen>
      <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <LiffGhostLink href="/">← メニュー</LiffGhostLink>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <LiffAccountBar
            loading={account.loading}
            pictureUrl={account.pictureUrl}
            boundStaffName={account.boundStaffName}
            bindingEnabled={account.bindingEnabled}
          />
        </div>
      </header>

      <main className="liff-page-main mx-auto w-full max-w-lg flex-1 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <LiffPageHeader
          title="営業進捗"
          subtitle={data?.monthLabel ? `${data.monthLabel}の目標に対する進捗` : undefined}
        />

        <LiffStaffBindingConfigNotice message={account.bindingConfigError} />

        {needsStaffBind ? (
          <LiffStaffBindPanel
            staff={account.staff}
            bindingEnabled={account.bindingEnabled}
            boundStaffName={account.boundStaffName}
            accountLoading={account.loading}
            onBind={account.bindStaff}
          />
        ) : (
          <>
            {/* 対象月。当月＋過去6ヶ月 */}
            <label className="mb-4 block">
              <span className="mb-1 block text-[12px] font-medium text-slate-500 dark:text-slate-400">
                対象月
              </span>
              <select
                className="w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px] font-bold text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                value={ym || data?.ym || ""}
                disabled={monthOptions.length === 0}
                onChange={(e) => setYm(e.target.value)}
              >
                {monthOptions.length === 0 ? (
                  <option value="">読み込み中…</option>
                ) : null}
                {monthOptions.map((o) => (
                  <option key={o.ym} value={o.ym}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            {isLoading && !data ? (
              <LiffLoadingBlock message="営業進捗を読み込み中…" />
            ) : data?.error ? (
              <LiffCard>
                <p className="px-4 py-6 text-center text-[14px] text-red-700 dark:text-red-300">
                  {data.error}
                </p>
              </LiffCard>
            ) : !data ? (
              <LiffCard>
                <p className="px-4 py-6 text-center text-[14px] text-slate-600 dark:text-slate-300">
                  営業進捗を取得できませんでした
                </p>
              </LiffCard>
            ) : (
              <div className="flex flex-col gap-3">
                {!data.targetsAvailable ? (
                  <p
                    role="status"
                    aria-live="polite"
                    className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] font-bold leading-relaxed text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                  >
                    {data.monthLabel}の目標が登録されていません。達成率は「—」になります。
                  </p>
                ) : null}

                {/* ── 自分の数字（本人のみ） ── */}
                <LiffCard>
                  <div className="px-4 py-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <h2 className="text-[13px] font-bold text-slate-700 dark:text-slate-200">
                        自分の数字
                      </h2>
                      <span className="text-[12px] text-slate-500 dark:text-slate-400">
                        {data.staffName}
                      </span>
                    </div>
                    {data.selfTargetMissing ? (
                      <p className="mb-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                        この月のあなたの目標は登録されていません。
                      </p>
                    ) : null}
                    <SalesProgressBar label="PT" metric={data.self.pt} tone="self" />
                    <SalesProgressBar
                      label="アポ"
                      metric={data.self.apo}
                      unit="件"
                      tone="self"
                    />
                  </div>
                </LiffCard>

                {/* ── 全体の進捗 ── */}
                <LiffCard>
                  <div className="px-4 py-4">
                    <h2 className="mb-2 text-[13px] font-bold text-slate-700 dark:text-slate-200">
                      全体の進捗
                    </h2>
                    <SalesProgressBar label="PT" metric={data.company.pt} />
                    <SalesProgressBar
                      label="アポ"
                      metric={data.company.apo}
                      unit="件"
                    />
                  </div>
                </LiffCard>

                {/* ── 支社別（既定は閉じる） ── */}
                <LiffCard>
                  <div className="px-4 py-4">
                    <button
                      type="button"
                      aria-expanded={branchOpen}
                      aria-controls={branchListId}
                      onClick={() => setBranchOpen((v) => !v)}
                      className="flex w-full items-center justify-between gap-2 text-left"
                    >
                      <span className="text-[13px] font-bold text-slate-700 dark:text-slate-200">
                        支社別
                      </span>
                      <span
                        className={`text-slate-400 transition-transform ${
                          branchOpen ? "rotate-90" : ""
                        }`}
                        aria-hidden
                      >
                        ›
                      </span>
                    </button>

                    {branchOpen ? (
                      <div id={branchListId} className="mt-3 flex flex-col gap-4">
                        {data.branches.map((b) => (
                          <div key={b.label}>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-[13px] font-bold text-slate-800 dark:text-slate-100">
                                {b.label}
                              </span>
                              <span className="text-[11px] text-slate-400">
                                {b.memberCount}名
                              </span>
                            </div>
                            <SalesProgressBar
                              label="PT"
                              metric={b.metrics.pt}
                              tone="branch"
                            />
                            <SalesProgressBar
                              label="アポ"
                              metric={b.metrics.apo}
                              unit="件"
                              tone="branch"
                            />
                          </div>
                        ))}
                        <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                          支社が未設定の方と、上記以外の支社の方は「
                          {data.branches[data.branches.length - 1]?.label ?? "その他"}
                          」に含めています。合計は全社の数字と一致します。
                        </p>
                      </div>
                    ) : (
                      <p id={branchListId} className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        {data.branches.length}件（
                        {formatSalesProgressNumber(
                          data.branches.reduce(
                            (s, b) => s + b.metrics.pt.actual,
                            0,
                          ),
                        )}
                        {" / "}
                        {formatSalesProgressRate(data.company.pt.ratePercent)}）
                      </p>
                    )}
                  </div>
                </LiffCard>
              </div>
            )}
          </>
        )}
      </main>
    </LiffScreen>
  );
}
