"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { WorkEndReportFormFields } from "@/components/work-end-report-form-fields";
import {
  clearClockOutReminderSnooze,
  snoozeClockOutReminderForSession,
} from "@/lib/attendance-clock-out-reminder-client";
import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";
import { liffAuthedJsonFetch } from "@/lib/liff-swr";
import {
  emptyWorkEndReportForm,
  isWorkEndReportFormSubmittable,
  submitWorkEndReport,
} from "@/lib/work-end-report-form-client";
import { isWorkEndReportEligibleDepartment } from "@/lib/work-end-report-eligibility";
import type { WorkEndReportStatus } from "@/lib/work-end-report-types";

type Props = {
  idToken: string;
  staffName?: string;
  workDate?: string;
  clockIn: string;
  onClose: () => void;
  zIndexClass?: string;
};

function formatDisplayTime(raw: string | null | undefined): string {
  if (!raw?.trim()) return "—";
  const s = raw.trim().replace("T", " ");
  const m = /(\d{1,2}:\d{2})/.exec(s);
  return m ? m[1]! : s;
}

export function AttendanceClockOutReminderAlert({
  idToken,
  staffName,
  workDate,
  clockIn,
  onClose,
  zIndexClass = "z-[135]",
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [submitting, setSubmitting] = useState<"out" | "out-report" | null>(
    null,
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workEndStatus, setWorkEndStatus] = useState<WorkEndReportStatus | null>(
    null,
  );
  const [workEndForm, setWorkEndForm] = useState(emptyWorkEndReportForm);

  useEffect(() => {
    setMounted(true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await liffAuthedJsonFetch<WorkEndReportStatus>(
          "/api/work-end-report",
          idToken,
        );
        if (!cancelled) setWorkEndStatus(data);
      } catch {
        /* 報告フォームは任意のため、取得失敗時は退勤打刻のみ */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idToken]);

  const showWorkEndForm = Boolean(
    workEndStatus?.configured !== false &&
      workEndStatus?.canReport &&
      isWorkEndReportEligibleDepartment(workEndStatus?.department),
  );

  const handleClose = useCallback(() => {
    snoozeClockOutReminderForSession();
    onClose();
  }, [onClose]);

  const finishAfterPunch = useCallback(
    (clockOut: string | null | undefined, message: string) => {
      clearClockOutReminderSnooze();
      setFeedback(
        clockOut ? `${message}（${formatDisplayTime(clockOut)}）` : message,
      );
      window.setTimeout(onClose, 900);
    },
    [onClose],
  );

  const punchOut = useCallback(async () => {
    if (submitting) return;
    setSubmitting("out");
    setFeedback(null);
    setError(null);
    try {
      const res = await fetch("/api/attendance/punch", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ kind: "out" }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        clockOut?: string | null;
      };
      if (res.status === 401 && isLineSessionExpiredPayload(data)) {
        setError("LINE のログインが切れました。アプリを開き直してください。");
        return;
      }
      if (!res.ok) {
        setError(
          data.error ??
            (res.status === 429
              ? "データ取得の利用上限に達しました。しばらく待ってから再度お試しください。"
              : "退勤打刻に失敗しました"),
        );
        return;
      }
      finishAfterPunch(data.clockOut, "退勤を打刻しました");
    } catch {
      setError("退勤打刻に失敗しました");
    } finally {
      setSubmitting(null);
    }
  }, [finishAfterPunch, idToken, submitting]);

  const punchOutWithReport = useCallback(async () => {
    if (submitting || !isWorkEndReportFormSubmittable(workEndForm)) return;
    setSubmitting("out-report");
    setFeedback(null);
    setError(null);
    try {
      const res = await fetch("/api/attendance/punch", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ kind: "out" }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        clockOut?: string | null;
      };
      if (res.status === 401 && isLineSessionExpiredPayload(data)) {
        setError("LINE のログインが切れました。アプリを開き直してください。");
        return;
      }
      if (!res.ok) {
        setError(
          data.error ??
            (res.status === 429
              ? "データ取得の利用上限に達しました。しばらく待ってから再度お試しください。"
              : "退勤打刻に失敗しました"),
        );
        return;
      }

      const reportResult = await submitWorkEndReport(idToken, workEndForm);
      if (!reportResult.ok) {
        setError(
          `退勤は打刻済みです。稼働終了報告のみ失敗しました: ${reportResult.error}`,
        );
        return;
      }
      finishAfterPunch(
        data.clockOut,
        "退勤打刻と稼働終了報告が完了しました",
      );
    } catch {
      setError("退勤打刻または稼働終了報告に失敗しました");
    } finally {
      setSubmitting(null);
    }
  }, [finishAfterPunch, idToken, submitting, workEndForm]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${zIndexClass} flex min-h-dvh flex-col bg-amber-50 text-slate-800 dark:bg-slate-900 dark:text-slate-100`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="attendance-clock-out-reminder-title"
    >
      <div className="shrink-0 border-b border-amber-200 bg-amber-100 px-4 py-5 text-center pt-[max(0.75rem,env(safe-area-inset-top))] dark:border-amber-800 dark:bg-amber-950/60">
        <p
          id="attendance-clock-out-reminder-title"
          className="text-[20px] font-bold text-amber-950 dark:text-amber-100"
        >
          退勤打刻をお忘れではありませんか？
        </p>
        <p className="mt-1 text-[14px] text-amber-900/80 dark:text-amber-200/80">
          {workDate ? `${workDate} · ` : ""}
          {staffName ? `${staffName} · ` : ""}
          出勤 {formatDisplayTime(clockIn)}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">
          18:30を過ぎていますが、本日の退勤打刻がまだされていません。退勤打刻を行ってください。
        </p>

        {showWorkEndForm ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-white px-4 py-4 dark:border-amber-800 dark:bg-slate-800">
            <h2 className="text-[14px] font-bold text-slate-800 dark:text-slate-100">
              稼働終了報告
            </h2>
            <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
              退勤打刻とあわせて本日分を報告できます
            </p>
            <div className="mt-4">
              <WorkEndReportFormFields
                compact
                form={workEndForm}
                onChange={setWorkEndForm}
                staffName={
                  workEndStatus?.staffName ?? staffName ?? ""
                }
                reportDate={workEndStatus?.reportDate ?? workDate ?? ""}
                disabled={submitting !== null || Boolean(feedback)}
              />
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-center text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </p>
        ) : null}
        {feedback ? (
          <p className="mt-4 text-center text-[14px] font-semibold text-emerald-700 dark:text-emerald-400">
            {feedback}
          </p>
        ) : null}
      </div>

      <div className="shrink-0 flex flex-col gap-2 border-t border-amber-200 bg-amber-50 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-amber-800 dark:bg-slate-900">
        {showWorkEndForm ? (
          <>
            <button
              type="button"
              disabled={
                submitting !== null ||
                Boolean(feedback) ||
                !isWorkEndReportFormSubmittable(workEndForm)
              }
              onClick={() => void punchOutWithReport()}
              className="w-full rounded-xl bg-amber-600 py-3.5 text-center text-[16px] font-bold text-white shadow-md transition-colors active:bg-amber-700 disabled:opacity-50 dark:bg-amber-700 dark:active:bg-amber-800"
            >
              {submitting === "out-report"
                ? "打刻・報告中…"
                : "退勤打刻して稼働終了を報告"}
            </button>
            <button
              type="button"
              disabled={submitting !== null || Boolean(feedback)}
              onClick={() => void punchOut()}
              className="w-full rounded-xl border border-amber-300 bg-white py-3.5 text-center text-[15px] font-semibold text-slate-800 transition-colors active:bg-amber-50 disabled:opacity-50 dark:border-amber-700 dark:bg-slate-800 dark:text-slate-100 dark:active:bg-slate-700"
            >
              {submitting === "out" ? "打刻中…" : "退勤打刻のみ"}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={submitting !== null || Boolean(feedback)}
            onClick={() => void punchOut()}
            className="w-full rounded-xl bg-amber-600 py-3.5 text-center text-[16px] font-bold text-white shadow-md transition-colors active:bg-amber-700 disabled:opacity-50 dark:bg-amber-700 dark:active:bg-amber-800"
          >
            {submitting === "out" ? "打刻中…" : "退勤打刻する"}
          </button>
        )}
        <Link
          href="/attendance"
          onClick={() => {
            snoozeClockOutReminderForSession();
            onClose();
          }}
          className="w-full rounded-xl border border-amber-300 bg-white py-3.5 text-center text-[15px] font-semibold text-slate-800 transition-colors active:bg-amber-50 dark:border-amber-700 dark:bg-slate-800 dark:text-slate-100 dark:active:bg-slate-700"
        >
          勤怠画面で打刻
        </Link>
        <button
          type="button"
          disabled={submitting !== null}
          onClick={handleClose}
          className="w-full rounded-xl border border-slate-200 bg-white py-3.5 text-[15px] font-semibold text-slate-700 transition-colors active:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:active:bg-slate-700"
        >
          閉じる
        </button>
      </div>
    </div>,
    document.body,
  );
}
