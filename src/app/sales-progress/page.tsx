"use client";

import { useCallback, useEffect, useId, useState } from "react";

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
import { SalesProgressHeadline } from "@/components/sales-progress-bar";
import {
  SalesProgressBranches,
  SalesProgressOverall,
} from "@/components/sales-progress-sections";
import { ThemeToggle } from "@/components/theme-toggle";
import { useLiffAccountStrip } from "@/hooks/use-liff-account-strip";
import { useLiffSwr } from "@/hooks/use-liff-swr";
import { initLiffAndGetToken } from "@/lib/liff-session";
import {
  LIFF_SWR_DASHBOARD_OPTIONS,
  isLiffSwrSessionExpired,
  liffAuthedJsonFetch,
} from "@/lib/liff-swr";
import type { SalesProgressMetricKey } from "@/lib/sales-progress-aggregate";
import type { SalesProgressPayload } from "@/app/api/sales-progress/route";

/**
 * 営業進捗（目標に対する達成率・タスクK / L）。
 *
 * 既存の /sales-dashboard とは別の画面。既存側は変更していない。
 * 計算はこの画面に書かない。整形も並び替えも sales-progress-aggregate.ts の
 * 純粋関数を呼ぶだけにしている。
 *
 * タスクL の変更:
 *   - 支社をタップすると担当者ごとの内訳が開く
 *   - PT / アポ の切り替えを画面上部に置き、全体・支社別・内訳へ連動させる
 *   - 支社別を表形式に寄せ、1支社あたり2行に収めた
 */

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

const METRIC_TABS: Array<{ id: SalesProgressMetricKey; label: string }> = [
  { id: "pt", label: "PT" },
  { id: "apo", label: "アポ" },
];

export default function SalesProgressPage() {
  const [phase, setPhase] = useState<
    "init" | "need-login" | "ready" | "error" | "session-expired"
  >(() => (LIFF_ID ? "init" : "error"));
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    LIFF_ID ? null : "NEXT_PUBLIC_LIFF_ID が設定されていません",
  );
  const [idToken, setIdToken] = useState<string | null>(null);
  const [ym, setYm] = useState("");
  const [metric, setMetric] = useState<SalesProgressMetricKey>("pt");
  const metricGroupId = useId();

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

  type ProgressBody = SalesProgressPayload & {
    error?: string;
    disabled?: boolean;
  };

  const { data, error: swrError, isLoading, mutate } =
    useLiffSwr<ProgressBody>(apiPath, idToken, LIFF_SWR_DASHBOARD_OPTIONS);

  /**
   * 集計のキャッシュを無視して取り直す（タスクO-2）。
   * TTL を30分に伸ばしたぶん、最新が要るときの手段を用意する。
   * サーバ側で同一利用者60秒に1回へ絞っているので、連打しても
   * @pocket は叩かれない（refreshThrottled が返る）。
   */
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");

  const handleRefresh = useCallback(async () => {
    if (!idToken || !apiPath || refreshing) return;
    setRefreshing(true);
    setRefreshMessage("");
    try {
      const sep = apiPath.includes("?") ? "&" : "?";
      const fresh = await liffAuthedJsonFetch<ProgressBody>(
        `${apiPath}${sep}refresh=1`,
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
  }, [idToken, apiPath, refreshing, mutate]);

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
  /** 寄せ先の見出しは応答の末尾の支社。既定は「その他」 */
  const otherLabel = data?.branches[data.branches.length - 1]?.label ?? "その他";

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
          action={
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={refreshing || !apiPath}
              className="rounded-lg px-2 py-1 text-[13px] font-medium text-sky-700 active:bg-sky-50 disabled:opacity-50 dark:text-sky-300 dark:active:bg-sky-950/40"
            >
              {refreshing ? "更新中…" : "更新"}
            </button>
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
            {/* 対象月と指標。指標は全体・支社別・内訳へ連動する */}
            <div className="mb-3 flex items-center gap-2">
              <select
                aria-label="対象月"
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[14px] font-bold text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"
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

              <div
                role="radiogroup"
                aria-label="表示する指標"
                id={metricGroupId}
                className="flex shrink-0 gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900"
              >
                {METRIC_TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={metric === t.id}
                    onClick={() => setMetric(t.id)}
                    className={`rounded-lg px-3 py-1.5 text-[13px] font-bold transition-colors ${
                      metric === t.id
                        ? "bg-sky-600 text-white dark:bg-sky-500"
                        : "text-slate-600 active:bg-slate-100 dark:text-slate-300 dark:active:bg-slate-800"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

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
              <div className="flex flex-col gap-2">
                {/* ── 自分の数字（PT・アポの両方を常に出す） ── */}
                <LiffCard>
                  <div className="px-4 py-3">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h2 className="text-[12px] font-bold text-slate-500 dark:text-slate-400">
                        自分の数字
                      </h2>
                      <span className="text-[13px] font-bold text-slate-800 dark:text-slate-100">
                        {data.staffName}
                      </span>
                    </div>
                    {data.selfTargetMissing ? (
                      // 0 / 0 と「—」を並べても意味が無いので実績だけ大きく出す
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {data.monthLabel}の目標は未登録です
                      </p>
                    ) : null}
                    <div className="mt-1 divide-y divide-slate-100 dark:divide-slate-700/60">
                      <SalesProgressHeadline
                        label="PT"
                        metric={data.self.pt}
                        tone="self"
                        targetKnown={!data.selfTargetMissing}
                      />
                      <SalesProgressHeadline
                        label="アポ"
                        metric={data.self.apo}
                        unit="件"
                        tone="self"
                        targetKnown={!data.selfTargetMissing}
                      />
                    </div>
                  </div>
                </LiffCard>

                {/* ── 全体の進捗（選んだ指標） ── */}
                <SalesProgressOverall
                  company={data.company}
                  metric={metric}
                  targetsAvailable={data.targetsAvailable}
                  periodLabel={data.monthLabel}
                />

                {/* ── 支社別（折りたたみなし・個人まで常に表示） ── */}
                <SalesProgressBranches
                  branches={data.branches}
                  metric={metric}
                  otherLabel={otherLabel}
                />
              </div>
            )}
          </>
        )}
      </main>
    </LiffScreen>
  );
}
