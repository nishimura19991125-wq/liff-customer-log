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
import {
  LIFF_SWR_DEFAULT_OPTIONS,
  isLiffSwrSessionExpired,
  liffAuthedJsonFetch,
} from "@/lib/liff-swr";
import type { WorkEndReportStatus } from "@/lib/work-end-report-types";
import {
  emptyWorkEndReportForm,
  isWorkEndReportFormSubmittable,
  submitWorkEndReport,
} from "@/lib/work-end-report-form-client";
import { WorkEndReportFormFields } from "@/components/work-end-report-form-fields";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

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
  /** 報告は提出できたが退勤打刻に失敗したとき（タスクX） */
  const [clockOutWarning, setClockOutWarning] = useState<string | null>(null);
  const [form, setForm] = useState(emptyWorkEndReportForm);

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
        () =>
          liffAuthedJsonFetch<WorkEndReportStatus>(
            "/api/work-end-report",
            idToken,
          ),
        { revalidate: false },
      );
    } catch {
      setFeedback("報告状況の取得に失敗しました");
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
    setClockOutWarning(null);
    try {
      const result = await submitWorkEndReport(idToken, form);
      if (!result.ok) {
        if (result.sessionExpired) {
          setPhase("session-expired");
          return;
        }
        setFeedback(result.error);
        return;
      }
      await mutateStatus(result.status, { revalidate: false });
      setFeedback("稼働終了を報告しました");
      setClockOutWarning(result.warning ?? null);
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
      <LiffSessionExpiredPanel
        footer={<LiffGhostLink href="/">トップへ</LiffGhostLink>}
      />
    );
  }

  const showSetupRequired = status?.configured === false;
  const alreadyReported = Boolean(!status?.canReport && status?.existingReport);
  const existing = status?.existingReport;

  return (
    <LiffScreen>
      <main className="liff-page-main mx-auto w-full max-w-lg flex-1 py-6">
        <LiffPageHeader
          title="稼働終了報告"
          subtitle="@pocket の稼働終了報告アプリに本日分を登録します"
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
          <LiffLoadingBlock message="報告状況を確認しています" />
        ) : showSetupRequired ? (
          <div className="mt-6">
            <LiffCard>
              <div className="px-5 py-6">
                <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">
                  {status?.configError ??
                    "稼働終了報告アプリが設定されていません。"}
                </p>
                <p className="mt-3 text-[13px] text-slate-500 dark:text-slate-400">
                  <span className="font-mono">WORK_END_REPORT_APP_ID</span> と{" "}
                  <span className="font-mono">
                    WORK_END_REPORT_ATPOCKET_API_KEY
                  </span>{" "}
                  系の環境変数を確認してください。
                </p>
              </div>
            </LiffCard>
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-4">
            {alreadyReported ? (
              <LiffCard>
                <div className="px-5 py-5">
                  <p className="text-[15px] font-semibold text-emerald-700 dark:text-emerald-400">
                    本日は報告済みです
                  </p>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-[14px]">
                    <div>
                      <dt className="text-slate-500 dark:text-slate-400">
                        ピンポン数
                      </dt>
                      <dd className="font-medium text-slate-800 dark:text-slate-100">
                        {existing?.pinponCount ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 dark:text-slate-400">
                        面談数
                      </dt>
                      <dd className="font-medium text-slate-800 dark:text-slate-100">
                        {existing?.meetingCount ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 dark:text-slate-400">
                        アポ獲得数
                      </dt>
                      <dd className="font-medium text-slate-800 dark:text-slate-100">
                        {existing?.apoCount ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 dark:text-slate-400">
                        アポ活動実施
                      </dt>
                      <dd className="font-medium text-slate-800 dark:text-slate-100">
                        {existing?.apoActivity ?? "—"}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-slate-500 dark:text-slate-400">
                        稼働エリア
                      </dt>
                      <dd className="font-medium text-slate-800 dark:text-slate-100">
                        {existing?.workArea ?? "—"}
                      </dd>
                    </div>
                  </dl>
                </div>
              </LiffCard>
            ) : (
              <LiffCard>
                <div className="px-5 py-5">
                  <WorkEndReportFormFields
                    form={form}
                    onChange={setForm}
                    staffName={status?.staffName ?? account.boundStaffName ?? ""}
                    reportDate={status?.reportDate ?? ""}
                    disabled={submitting || needsStaffBind}
                  />
                </div>
              </LiffCard>
            )}

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

            {/*
              報告は出せたが退勤打刻に失敗したとき（タスクX）。
              提出成功の緑メッセージに紛れ込ませると気づかれないので別枠で出す。
              手動で復旧できることを必ず伝える
            */}
            {clockOutWarning ? (
              <p
                role="alert"
                aria-live="assertive"
                className="rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3 text-[13px] font-bold leading-relaxed text-amber-900"
              >
                ⚠ {clockOutWarning}
              </p>
            ) : null}

            {!alreadyReported ? (
              <LiffPrimaryButton
                disabled={
                  needsStaffBind ||
                  submitting ||
                  !status?.canReport ||
                  !isWorkEndReportFormSubmittable(form) ||
                  Boolean(feedback?.includes("報告しました"))
                }
                onClick={() => void handleSubmit()}
              >
                {submitting ? "報告中…" : "稼働終了を報告する"}
              </LiffPrimaryButton>
            ) : null}

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
