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
import {
  WORK_END_REPORT_APO_ACTIVITY_OPTIONS,
  isWorkEndApoActivityImplemented,
} from "@/lib/work-end-report-types";
import { isWorkEndReportEligibleDepartment } from "@/lib/work-end-report-eligibility";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[14px] text-slate-900 shadow-sm disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-white";

const readOnlyClass =
  "w-full rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-[14px] text-slate-700 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-200";

type FormState = {
  pinponCount: string;
  meetingCount: string;
  apoCount: string;
  apoActivity: string;
  workArea: string;
};

const emptyForm = (): FormState => ({
  pinponCount: "",
  meetingCount: "",
  apoCount: "",
  apoActivity: "",
  workArea: "",
});

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
  const [form, setForm] = useState<FormState>(emptyForm);

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
    try {
      const res = await fetch("/api/work-end-report", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
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
      setFeedback("稼働終了を報告しました");
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
  const showIneligible =
    status?.configured !== false &&
    status?.eligible === false &&
    !status?.needsStaffBind;
  const alreadyReported = Boolean(!status?.canReport && status?.existingReport);
  const existing = status?.existingReport;
  const apoActivityRequired = isWorkEndApoActivityImplemented(form.apoActivity);
  const detailFieldsDisabled =
    submitting || needsStaffBind || !apoActivityRequired;

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
        ) : showIneligible ? (
          <div className="mt-6">
            <LiffCard>
              <div className="px-5 py-6">
                <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">
                  {status?.ineligibleMessage ??
                    "この機能は DC事業部・工務店アライアンス事業部の社員のみ利用できます。"}
                </p>
                {status?.department ? (
                  <p className="mt-3 text-[13px] text-slate-500 dark:text-slate-400">
                    名簿の部署: {status.department}
                  </p>
                ) : null}
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
                <div className="flex flex-col gap-4 px-5 py-5">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
                      報告者
                    </span>
                    <input
                      type="text"
                      className={readOnlyClass}
                      value={status?.staffName ?? account.boundStaffName ?? ""}
                      readOnly
                      aria-readonly
                    />
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
                      報告日
                    </span>
                    <input
                      type="text"
                      className={readOnlyClass}
                      value={status?.reportDate ?? ""}
                      readOnly
                      aria-readonly
                    />
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
                      アポ活動実施
                      <span className="ml-0.5 text-red-500">*</span>
                    </span>
                    <select
                      className={inputClass}
                      value={form.apoActivity}
                      onChange={(e) => {
                        const next = e.target.value;
                        setForm((prev) => ({
                          ...prev,
                          apoActivity: next,
                          ...(isWorkEndApoActivityImplemented(next)
                            ? {}
                            : {
                                pinponCount: "",
                                meetingCount: "",
                                apoCount: "",
                                workArea: "",
                              }),
                        }));
                      }}
                      disabled={submitting || needsStaffBind}
                    >
                      <option value="">選択してください</option>
                      {WORK_END_REPORT_APO_ACTIVITY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
                      ピンポン数
                      {apoActivityRequired ? (
                        <span className="ml-0.5 text-red-500">*</span>
                      ) : null}
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      className={inputClass}
                      value={form.pinponCount}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          pinponCount: e.target.value,
                        }))
                      }
                      disabled={detailFieldsDisabled}
                    />
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
                      面談数
                      {apoActivityRequired ? (
                        <span className="ml-0.5 text-red-500">*</span>
                      ) : null}
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      className={inputClass}
                      value={form.meetingCount}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          meetingCount: e.target.value,
                        }))
                      }
                      disabled={detailFieldsDisabled}
                    />
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
                      アポ獲得数
                      {apoActivityRequired ? (
                        <span className="ml-0.5 text-red-500">*</span>
                      ) : null}
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      className={inputClass}
                      value={form.apoCount}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          apoCount: e.target.value,
                        }))
                      }
                      disabled={detailFieldsDisabled}
                    />
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
                      稼働エリア
                      {apoActivityRequired ? (
                        <span className="ml-0.5 text-red-500">*</span>
                      ) : null}
                    </span>
                    <input
                      type="text"
                      className={inputClass}
                      value={form.workArea}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          workArea: e.target.value,
                        }))
                      }
                      placeholder={
                        apoActivityRequired ? "例: 奈良・大阪北部" : "実施時のみ入力"
                      }
                      disabled={detailFieldsDisabled}
                    />
                  </label>
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

            {!alreadyReported ? (
              <LiffPrimaryButton
                disabled={
                  needsStaffBind ||
                  submitting ||
                  !status?.canReport ||
                  !form.apoActivity ||
                  Boolean(feedback?.includes("報告しました")) ||
                  (apoActivityRequired &&
                    (!form.pinponCount.trim() ||
                      !form.meetingCount.trim() ||
                      !form.apoCount.trim() ||
                      !form.workArea.trim()))
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
