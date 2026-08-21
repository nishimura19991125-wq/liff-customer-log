"use client";

import { useCallback, useEffect, useState } from "react";

import { AttendanceMonthCalendar } from "@/components/attendance-month-calendar";

import { useLiffSwr } from "@/hooks/use-liff-swr";
import {
  liffAuthedJsonFetch,
  LIFF_SWR_ATTENDANCE_OPTIONS,
  LIFF_SWR_DEFAULT_OPTIONS,
  isLiffSwrSessionExpired,
} from "@/lib/liff-swr";
import type { WorkEndReportStatus } from "@/lib/work-end-report-types";
import {
  emptyWorkEndReportForm,
  isWorkEndReportFormSubmittable,
  submitWorkEndReport,
} from "@/lib/work-end-report-form-client";
import { WorkEndReportFormFields } from "@/components/work-end-report-form-fields";
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
import { initLiffAndGetToken } from "@/lib/liff-session";
import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";
import { requestMeetingScheduleAlertCheckAfterPunch } from "@/lib/meeting-schedule-pending-set-created-client";
import { formatAttendanceDisplayTime } from "@/lib/attendance-calendar-types";
import { isWorkEndReportEligibleDepartment } from "@/lib/work-end-report-eligibility";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

type AttendanceStatus = {
  configured?: boolean;
  disabled?: boolean;
  configError?: string;
  needsStaffBind?: boolean;
  staffName?: string;
  workDate?: string;
  clockIn?: string | null;
  clockOut?: string | null;
  canClockIn?: boolean;
  canClockOut?: boolean;
  rateLimited?: boolean;
  stale?: boolean;
  todayAttendees?: Array<{
    staffName: string;
    clockIn: string;
    clockOut: string | null;
    department?: string;
  }>;
  todayAttendeesByDepartment?: Array<{
    department: string;
    attendees: Array<{
      staffName: string;
      clockIn: string;
      clockOut: string | null;
      department?: string;
    }>;
  }>;
  error?: string;
};

function ClockGlyph() {
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
        d="M12 7v5l3 2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function AttendancePage() {
  const [phase, setPhase] = useState<
    "init" | "need-login" | "ready" | "error" | "session-expired"
  >(() => (LIFF_ID ? "init" : "error"));
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    LIFF_ID ? null : "NEXT_PUBLIC_LIFF_ID が設定されていません",
  );
  const [idToken, setIdToken] = useState<string | null>(null);
  const [punching, setPunching] = useState<"in" | "out" | "out-report" | null>(
    null,
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  /** 打刻は成功したが Google Chat 通知に失敗したとき（タスクW） */
  const [punchWarning, setPunchWarning] = useState<string | null>(null);
  const [workEndForm, setWorkEndForm] = useState(emptyWorkEndReportForm);

  const account = useLiffAccountStrip(idToken, phase === "ready");
  const needsStaffBind =
    account.bindingEnabled &&
    !account.boundStaffName &&
    !account.loading &&
    account.staff.length > 0;

  const canUseAttendance =
    Boolean(idToken) &&
    phase === "ready" &&
    !needsStaffBind &&
    !account.loading &&
    Boolean(account.boundStaffName || !account.bindingEnabled);

  const attendancePath = canUseAttendance ? "/api/attendance" : null;
  const {
    data: status,
    error: swrError,
    isLoading: statusLoading,
    mutate: mutateStatus,
  } = useLiffSwr<AttendanceStatus>(
    attendancePath,
    idToken,
    LIFF_SWR_ATTENDANCE_OPTIONS,
  );

  const {
    data: workEndStatus,
    mutate: mutateWorkEndStatus,
  } = useLiffSwr<WorkEndReportStatus>(
    canUseAttendance ? "/api/work-end-report" : null,
    idToken,
    LIFF_SWR_DEFAULT_OPTIONS,
  );

  const loading = statusLoading && !status;
  const showWorkEndOnClockOut = Boolean(
    status?.canClockOut &&
      workEndStatus?.configured !== false &&
      workEndStatus?.canReport &&
      isWorkEndReportEligibleDepartment(
        account.boundStaffDepartment ?? workEndStatus?.department,
      ),
  );

  const refreshStatus = useCallback(async () => {
    if (!idToken || !canUseAttendance) return;
    setFeedback(null);
    try {
      await mutateStatus(
        () =>
          liffAuthedJsonFetch<AttendanceStatus>(
            "/api/attendance?refresh=1",
            idToken,
          ),
        { revalidate: false },
      );
    } catch {
      setFeedback("勤怠情報の取得に失敗しました");
    }
  }, [idToken, canUseAttendance, mutateStatus]);

  useEffect(() => {
    if (!swrError || phase !== "ready") return;
    if (isLiffSwrSessionExpired(swrError)) {
      setPhase("session-expired");
      return;
    }
    setFeedback(swrError.message);
  }, [swrError, phase]);

  useEffect(() => {
    if (status?.rateLimited && status.configError) {
      setFeedback(status.configError);
    }
  }, [status?.rateLimited, status?.configError]);

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

  async function handlePunch(kind: "in" | "out") {
    if (!idToken || punching) return;
    setPunching(kind);
    setFeedback(null);
    setPunchWarning(null);
    try {
      const res = await fetch("/api/attendance/punch", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ kind }),
      });
      const data = (await res.json()) as AttendanceStatus & {
        ok?: boolean;
        /** 打刻は成功したが通知に失敗したとき（タスクW） */
        warning?: string;
      };
      if (res.status === 401 && isLineSessionExpiredPayload(data)) {
        setPhase("session-expired");
        return;
      }
      if (!res.ok) {
        setFeedback(
          data.error ??
            (res.status === 429
              ? "データ取得の利用上限に達しました。1〜2分待ってから再度お試しください。"
              : "打刻に失敗しました"),
        );
        return;
      }
      await mutateStatus(data, { revalidate: false });
      if (kind === "in") {
        requestMeetingScheduleAlertCheckAfterPunch();
      }
      setFeedback(kind === "in" ? "出勤を打刻しました" : "退勤を打刻しました");
      setPunchWarning(data.warning?.trim() || null);
    } catch {
      setFeedback("打刻に失敗しました");
    } finally {
      setPunching(null);
    }
  }

  async function handlePunchOutWithReport() {
    if (!idToken || punching || !isWorkEndReportFormSubmittable(workEndForm)) {
      return;
    }
    setPunching("out-report");
    setFeedback(null);
    try {
      const res = await fetch("/api/attendance/punch", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ kind: "out" }),
      });
      const data = (await res.json()) as AttendanceStatus & { ok?: boolean };
      if (res.status === 401 && isLineSessionExpiredPayload(data)) {
        setPhase("session-expired");
        return;
      }
      if (!res.ok) {
        setFeedback(
          data.error ??
            (res.status === 429
              ? "データ取得の利用上限に達しました。1〜2分待ってから再度お試しください。"
              : "退勤打刻に失敗しました"),
        );
        return;
      }
      await mutateStatus(data, { revalidate: false });

      const reportResult = await submitWorkEndReport(idToken, workEndForm);
      if (!reportResult.ok) {
        if (reportResult.sessionExpired) {
          setPhase("session-expired");
          return;
        }
        setFeedback(
          `退勤は打刻済みです。稼働終了報告のみ失敗しました: ${reportResult.error}`,
        );
        return;
      }
      await mutateWorkEndStatus(reportResult.status, { revalidate: false });
      setWorkEndForm(emptyWorkEndReportForm());
      setFeedback("退勤打刻と稼働終了報告が完了しました");
    } catch {
      setFeedback("退勤打刻または稼働終了報告に失敗しました");
    } finally {
      setPunching(null);
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
    return <LiffSessionExpiredPanel footer={<LiffGhostLink href="/">トップへ</LiffGhostLink>} />;
  }

  const showSetupRequired =
    status?.configured === false && !status?.rateLimited;
  const workDate = status?.workDate ?? "—";
  const departmentGroups =
    status?.todayAttendeesByDepartment ??
    (status?.todayAttendees?.length
      ? [
          {
            department: "部署未設定",
            attendees: status.todayAttendees,
          },
        ]
      : []);
  const totalAttendeeCount =
    status?.todayAttendees?.length ??
    departmentGroups.reduce((n, g) => n + g.attendees.length, 0);

  return (
    <LiffScreen>
      <main className="liff-page-main mx-auto w-full max-w-lg flex-1 py-6">
        <LiffPageHeader
          title="勤怠管理"
          subtitle="出勤・退勤を打刻し、@pocket の勤怠アプリに記録します"
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
          <LiffGhostLink href="/">← トップへ</LiffGhostLink>
        </div>

        <LiffStaffBindingConfigNotice message={account.bindingConfigError} />
        <LiffStaffBindPanel
          staff={account.staff}
          bindingEnabled={account.bindingEnabled}
          boundStaffName={account.boundStaffName}
          accountLoading={account.loading}
          onBind={account.bindStaff}
        />

        {status?.rateLimited && status.configError ? (
          <p className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-[14px] leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            {status.configError}
          </p>
        ) : null}

        {showSetupRequired ? (
          <LiffCard>
            <div className="px-5 py-6">
              <p className="text-[14px] leading-relaxed text-amber-900 dark:text-amber-100">
                勤怠機能は未設定です。Netlify の環境変数に{" "}
                <span className="font-mono text-[13px]">ATTENDANCE_APP_ID</span>{" "}
                と勤怠用 API キー（{" "}
                <span className="font-mono text-[13px]">
                  ATTENDANCE_ATPOCKET_API_KEY
                </span>{" "}
                等）を設定してください。
              </p>
              {status?.configError ? (
                <p className="mt-3 text-[13px] text-slate-600 dark:text-slate-400">
                  {status.configError}
                </p>
              ) : null}
            </div>
          </LiffCard>
        ) : needsStaffBind ? (
          <p className="text-[14px] text-slate-600 dark:text-slate-400">
            打刻するには、先にスタッフ名簿と紐づけてください。
          </p>
        ) : (
          <>
            <LiffCard>
              <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-700">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
                  <ClockGlyph />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-slate-500 dark:text-slate-400">
                    {workDate}（本日）
                  </p>
                  <p className="truncate text-[17px] font-bold text-slate-900 dark:text-white">
                    {status?.staffName ?? account.boundStaffName ?? "—"}
                  </p>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-px bg-slate-100 dark:bg-slate-700">
                <div className="bg-white px-5 py-4 dark:bg-slate-800">
                  <dt className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
                    出勤
                  </dt>
                  <dd className="mt-1 text-[20px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {loading ? "…" : formatAttendanceDisplayTime(status?.clockIn)}
                  </dd>
                </div>
                <div className="bg-white px-5 py-4 dark:bg-slate-800">
                  <dt className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
                    退勤
                  </dt>
                  <dd className="mt-1 text-[20px] font-bold tabular-nums text-slate-800 dark:text-slate-100">
                    {loading ? "…" : formatAttendanceDisplayTime(status?.clockOut)}
                  </dd>
                </div>
              </dl>
            </LiffCard>

            <div className="mt-4">
            <LiffCard>
              <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-700">
                <h2 className="text-[14px] font-bold text-slate-800 dark:text-slate-100">
                  本日の出勤者
                  {totalAttendeeCount > 0 ? `（${totalAttendeeCount}人）` : ""}
                </h2>
              </div>
              <div className="max-h-52 overflow-y-auto px-5 py-3">
                {loading ? (
                  <p className="text-[13px] text-slate-500">読み込み中…</p>
                ) : totalAttendeeCount === 0 ? (
                  <p className="text-[13px] text-slate-500 dark:text-slate-400">
                    まだ出勤打刻はありません
                  </p>
                ) : (
                  <div className="flex flex-col gap-4">
                    {departmentGroups.map((group) => (
                      <section key={group.department}>
                        <h3 className="mb-2 text-[12px] font-bold text-slate-600 dark:text-slate-300">
                          {group.department}
                          <span className="ml-1 font-medium text-slate-500 dark:text-slate-400">
                            （{group.attendees.length}人）
                          </span>
                        </h3>
                        <ul className="flex flex-col gap-2">
                          {group.attendees.map((person) => {
                            const isSelf =
                              person.staffName ===
                              (status?.staffName ?? account.boundStaffName);
                            return (
                              <li
                                key={`${group.department}-${person.staffName}`}
                                className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-[13px] ${
                                  isSelf
                                    ? "bg-emerald-50 font-semibold text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100"
                                    : "bg-slate-50 text-slate-800 dark:bg-slate-800/80 dark:text-slate-100"
                                }`}
                              >
                                <span className="min-w-0 truncate">
                                  {person.staffName}
                                  {isSelf ? (
                                    <span className="ml-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                                      （あなた）
                                    </span>
                                  ) : null}
                                </span>
                                <span className="shrink-0 tabular-nums text-slate-600 dark:text-slate-300">
                                  {formatAttendanceDisplayTime(person.clockIn)}
                                  {person.clockOut
                                    ? ` 〜 ${formatAttendanceDisplayTime(person.clockOut)}`
                                    : ""}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    ))}
                  </div>
                )}
              </div>
            </LiffCard>
            </div>

            <div className="mt-4">
              <LiffCard>
                <div className="px-5 py-4">
                  {idToken ? (
                    <AttendanceMonthCalendar idToken={idToken} />
                  ) : null}
                </div>
              </LiffCard>
            </div>

            {feedback ? (
              <p
                className={`mt-4 text-center text-[14px] font-medium ${
                  feedback.includes("失敗") || feedback.includes("済み")
                    ? "text-amber-800 dark:text-amber-200"
                    : "text-emerald-700 dark:text-emerald-400"
                }`}
              >
                {feedback}
              </p>
            ) : null}

            {/*
              打刻は成功したが Google Chat 通知に失敗したとき（タスクW）。
              成功メッセージに紛れ込ませると気づかれないので別枠・別色で出す
            */}
            {punchWarning ? (
              <p
                role="alert"
                aria-live="assertive"
                className="mt-3 rounded-xl border-2 border-amber-400 bg-amber-50 px-3 py-2.5 text-[13px] font-bold leading-relaxed text-amber-900"
              >
                ⚠ {punchWarning}
              </p>
            ) : null}

            <p className="mt-3 text-center text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
              @pocket に本日の打刻が無い場合（削除・未登録）は、再度打刻できます。
              <button
                type="button"
                className="mt-1 block w-full text-[13px] font-semibold text-emerald-700 underline underline-offset-2 disabled:opacity-50 dark:text-emerald-400"
                disabled={loading || punching !== null}
                onClick={() => void refreshStatus()}
              >
                @pocket の状態を再読み込み
              </button>
            </p>

            {showWorkEndOnClockOut ? (
              <LiffCard>
                <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-700">
                  <h2 className="text-[14px] font-bold text-slate-800 dark:text-slate-100">
                    稼働終了報告
                  </h2>
                  <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                    退勤打刻とあわせて本日分を報告できます（
                    {workEndStatus?.reportDate ?? workDate}）
                  </p>
                </div>
                <div className="px-5 py-5">
                  <WorkEndReportFormFields
                    compact
                    form={workEndForm}
                    onChange={setWorkEndForm}
                    staffName={
                      workEndStatus?.staffName ??
                      status?.staffName ??
                      account.boundStaffName ??
                      ""
                    }
                    reportDate={workEndStatus?.reportDate ?? workDate}
                    disabled={punching !== null}
                  />
                </div>
              </LiffCard>
            ) : null}

            <div className="mt-4 flex flex-col gap-3">
              <LiffPrimaryButton
                type="button"
                disabled={
                  loading ||
                  punching !== null ||
                  !status?.canClockIn
                }
                onClick={() => void handlePunch("in")}
              >
                {punching === "in" ? "打刻中…" : "出勤打刻"}
              </LiffPrimaryButton>
              {showWorkEndOnClockOut ? (
                <>
                  <LiffPrimaryButton
                    type="button"
                    disabled={
                      loading ||
                      punching !== null ||
                      !status?.canClockOut ||
                      !isWorkEndReportFormSubmittable(workEndForm)
                    }
                    onClick={() => void handlePunchOutWithReport()}
                  >
                    {punching === "out-report"
                      ? "打刻・報告中…"
                      : "退勤打刻して稼働終了を報告"}
                  </LiffPrimaryButton>
                  <button
                    type="button"
                    disabled={
                      loading ||
                      punching !== null ||
                      !status?.canClockOut
                    }
                    onClick={() => void handlePunch("out")}
                    className="inline-flex w-full items-center justify-center rounded-2xl border-2 border-slate-300 bg-white py-3.5 text-[15px] font-semibold text-slate-800 shadow-sm transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {punching === "out" ? "打刻中…" : "退勤打刻のみ"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={
                    loading ||
                    punching !== null ||
                    !status?.canClockOut
                  }
                  onClick={() => void handlePunch("out")}
                  className="inline-flex w-full items-center justify-center rounded-2xl border-2 border-slate-300 bg-white py-3.5 text-[15px] font-semibold text-slate-800 shadow-sm transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                >
                  {punching === "out" ? "打刻中…" : "退勤打刻"}
                </button>
              )}
            </div>

            {status?.clockIn && status?.clockOut ? (
              <p className="mt-4 text-center text-[13px] text-slate-500 dark:text-slate-400">
                本日の打刻は完了しています。@pocket で削除した場合は「再読み込み」のあと再度打刻できます。
              </p>
            ) : null}
          </>
        )}
      </main>
    </LiffScreen>
  );
}
