"use client";

import { useCallback, useEffect, useState } from "react";

import {
  LiffAccountBar,
  LiffCard,
  LiffGhostLink,
  LiffLoadingBlock,
  LiffPageHeader,
  LiffPrimaryButton,
  LiffScreen,
  LiffSessionExpiredPanel,
  LiffStaffBindPanel,
  LiffStaffBindingConfigNotice,
} from "@/components/liff-chrome";
import { ThemeToggle } from "@/components/theme-toggle";
import { useLiffAccountStrip } from "@/hooks/use-liff-account-strip";
import { useLiffSwr } from "@/hooks/use-liff-swr";
import { initLiffAndGetToken } from "@/lib/liff-session";
import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";
import {
  LIFF_SWR_DEFAULT_OPTIONS,
  isLiffSwrSessionExpired,
  liffAuthedJsonFetch,
} from "@/lib/liff-swr";
import type { WorkEndReportStatus } from "@/lib/work-end-report-types";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

function WorkEndGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M9 9l6 6M15 9l-6 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function statusBadgeClass(isActive: boolean): string {
  return isActive
    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
}

export default function WorkEndReportPage() {
  const [phase, setPhase] = useState<
    "init" | "need-login" | "ready" | "error" | "session-expired"
  >(() => (LIFF_ID ? "init" : "error"));
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    LIFF_ID ? null : "NEXT_PUBLIC_LIFF_ID が設定されていません",
  );
  const [idToken, setIdToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const account = useLiffAccountStrip(idToken, phase === "ready");
  const needsStaffBind =
    account.bindingEnabled &&
    !account.boundStaffName &&
    !account.loading &&
    account.staff.length > 0;

  const canUseReport =
    Boolean(idToken) &&
    phase === "ready" &&
    !needsStaffBind &&
    !account.loading &&
    Boolean(account.boundStaffName || !account.bindingEnabled);

  const reportPath = canUseReport ? "/api/work-end-report" : null;
  const {
    data: status,
    error: swrError,
    isLoading: statusLoading,
    mutate: mutateStatus,
  } = useLiffSwr<WorkEndReportStatus>(
    reportPath,
    idToken,
    LIFF_SWR_DEFAULT_OPTIONS,
  );

  const loading = statusLoading && !status;

  const refreshStatus = useCallback(async () => {
    if (!idToken || !canUseReport) return;
    setFeedback(null);
    try {
      await mutateStatus(
        () => liffAuthedJsonFetch<WorkEndReportStatus>("/api/work-end-report", idToken),
        { revalidate: false },
      );
    } catch {
      setFeedback("稼働状況の取得に失敗しました");
    }
  }, [idToken, canUseReport, mutateStatus]);

  useEffect(() => {
    if (!swrError || phase !== "ready") return;
    if (isLiffSwrSessionExpired(swrError)) {
      setPhase("session-expired");
      return;
    }
    setFeedback(swrError.message);
  }, [swrError, phase]);

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

  async function handleSubmit() {
    if (!idToken || submitting || !status?.canReport) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/work-end-report", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
      });
      const data = (await res.json()) as WorkEndReportStatus & {
        error?: string;
      };
      if (res.status === 401 && isLineSessionExpiredPayload(data)) {
        setPhase("session-expired");
        return;
      }
      if (!res.ok) {
        setFeedback(
          data.error ??
            (res.status === 429
              ? "データ取得の利用上限に達しました。しばらく待ってから再度お試しください。"
              : "稼働終了報告に失敗しました"),
        );
        return;
      }
      await mutateStatus(data, { revalidate: false });
      const updated = data.updatedFields?.join("、");
      setFeedback(
        updated
          ? `稼働終了を報告しました（${updated} → ${data.inactiveLabel}）`
          : "稼働終了を報告しました",
      );
    } catch {
      setFeedback("稼働終了報告に失敗しました");
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === "init" || phase === "need-login") {
    return (
      <LiffLoadingBlock
        message={
          phase === "need-login"
            ? "LINE でログインしています"
            : "アプリを起動しています"
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
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-red-700">
                {errorMessage}
              </p>
            </div>
          </LiffCard>
        </div>
      </LiffScreen>
    );
  }

  if (phase === "session-expired") {
    return (
      <LiffSessionExpiredPanel footer={<LiffGhostLink href="/">トップへ</LiffGhostLink>} />
    );
  }

  const showSetupRequired = status?.configured === false;

  return (
    <LiffScreen>
      <main className="liff-page-main mx-auto w-full max-w-lg flex-1 py-6">
        <LiffPageHeader
          title="稼働終了報告"
          subtitle="本日の稼働を終了し、名簿の稼働状況を更新します"
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

        <LiffStaffBindingConfigNotice message={account.bindingConfigError} />
        <LiffStaffBindPanel
          staff={account.staff}
          bindingEnabled={account.bindingEnabled}
          boundStaffName={account.boundStaffName}
          accountLoading={account.loading}
          onBind={account.bindStaff}
        />

        {loading ? (
          <LiffLoadingBlock message="稼働状況を確認しています" />
        ) : showSetupRequired ? (
          <div className="mt-6">
            <LiffCard>
              <div className="px-5 py-6">
              <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">
                {status?.configError ??
                  "スタッフ名簿の稼働状況列が設定されていません。"}
              </p>
              <p className="mt-3 text-[13px] text-slate-500 dark:text-slate-400">
                <span className="font-mono">STAFF_APP_ID</span> と稼働状況列の
                環境変数を確認してください。
              </p>
            </div>
          </LiffCard>
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-4">
            <LiffCard>
              <div className="flex items-start gap-4 px-5 py-5">
                <span className="flex size-[3.25rem] shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100/70 text-blue-500 dark:from-blue-950/80 dark:to-blue-900/50 dark:text-blue-400">
                  <WorkEndGlyph />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[1.05rem] font-bold text-slate-800 dark:text-slate-100">
                    {status?.staffName ?? account.boundStaffName ?? "—"}
                  </p>
                  <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
                    「{status?.activeLabel ?? "稼働"}」の項目を「
                    {status?.inactiveLabel ?? "非稼働"}」に更新します
                  </p>
                </div>
              </div>
            </LiffCard>

            {status?.fields?.length ? (
              <LiffCard>
                <div className="px-5 py-4">
                  <p className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">
                    現在の稼働状況
                  </p>
                  <ul className="mt-3 flex flex-col gap-2">
                    {status.fields.map((field) => (
                      <li
                        key={field.key}
                        className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2.5 dark:border-slate-800"
                      >
                        <span className="text-[14px] text-slate-700 dark:text-slate-200">
                          {field.label}
                        </span>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${statusBadgeClass(field.isActive)}`}
                        >
                          {field.currentValue || "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </LiffCard>
            ) : null}

            {feedback ? (
              <p
                className={`rounded-xl px-4 py-3 text-center text-[14px] font-medium ${
                  feedback.includes("報告しました")
                    ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200"
                }`}
              >
                {feedback}
              </p>
            ) : null}

            <LiffPrimaryButton
              disabled={
                needsStaffBind ||
                submitting ||
                !status?.canReport ||
                Boolean(feedback?.includes("報告しました"))
              }
              onClick={() => void handleSubmit()}
            >
              {submitting
                ? "報告中…"
                : status?.canReport
                  ? "稼働終了を報告する"
                  : "稼働終了済みです"}
            </LiffPrimaryButton>

            <button
              type="button"
              onClick={() => void refreshStatus()}
              disabled={submitting || needsStaffBind}
              className="text-center text-[14px] font-medium text-slate-500 underline underline-offset-2 disabled:opacity-50 dark:text-slate-400"
            >
              最新の状態を再取得
            </button>
          </div>
        )}

        <div className="mt-8">
          <LiffGhostLink href="/">トップへ戻る</LiffGhostLink>
        </div>
      </main>
    </LiffScreen>
  );
}
