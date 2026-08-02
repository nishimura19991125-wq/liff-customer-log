"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  AFTERNOON_CLOCK_IN_FROM_JST,
  clearAfternoonClockInSnooze,
  clearMorningLeaveForToday,
  snoozeAfternoonClockInForSession,
} from "@/lib/attendance-morning-leave-client";
import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";
import { requestMeetingScheduleAlertCheckAfterPunch } from "@/lib/meeting-schedule-pending-set-created-client";

type Props = {
  idToken: string;
  staffName: string;
  workDate?: string;
  onClose: () => void;
  zIndexClass?: string;
};

function formatDisplayTime(raw: string | null | undefined): string {
  if (!raw?.trim()) return "—";
  const s = raw.trim().replace("T", " ");
  const m = /(\d{1,2}:\d{2})/.exec(s);
  return m ? m[1]! : s;
}

export function AttendanceAfternoonClockInAlert({
  idToken,
  staffName,
  workDate,
  onClose,
  zIndexClass = "z-[135]",
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  const handleClose = useCallback(() => {
    snoozeAfternoonClockInForSession(staffName);
    onClose();
  }, [onClose, staffName]);

  const punchIn = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setFeedback(null);
    setError(null);
    try {
      const res = await fetch("/api/attendance/punch", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ kind: "in" }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        clockIn?: string | null;
      };
      if (res.status === 401 && isLineSessionExpiredPayload(data)) {
        setError("LINE のログインが切れました。アプリを開き直してください。");
        return;
      }
      if (!res.ok) {
        if (res.status === 409 && data.clockIn) {
          clearMorningLeaveForToday(staffName);
          clearAfternoonClockInSnooze(staffName);
          requestMeetingScheduleAlertCheckAfterPunch();
          setFeedback(
            `本日は出勤済みです（${formatDisplayTime(data.clockIn)}）`,
          );
          window.setTimeout(onClose, 900);
          return;
        }
        setError(
          data.error ??
            (res.status === 429
              ? "データ取得の利用上限に達しました。しばらく待ってから再度お試しください。"
              : "出勤登録に失敗しました"),
        );
        return;
      }
      clearMorningLeaveForToday(staffName);
      clearAfternoonClockInSnooze(staffName);
      requestMeetingScheduleAlertCheckAfterPunch();
      setFeedback(`出勤を登録しました（${formatDisplayTime(data.clockIn)}）`);
      window.setTimeout(onClose, 900);
    } catch {
      setError("出勤登録に失敗しました");
    } finally {
      setSubmitting(false);
    }
  }, [idToken, onClose, staffName, submitting]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${zIndexClass} flex min-h-dvh flex-col bg-sky-50 text-slate-800 dark:bg-slate-900 dark:text-slate-100`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="attendance-afternoon-clock-in-title"
    >
      <div className="shrink-0 border-b border-sky-200 bg-sky-100 px-4 py-5 text-center pt-[max(0.75rem,env(safe-area-inset-top))] dark:border-sky-800 dark:bg-sky-950/60">
        <p
          id="attendance-afternoon-clock-in-title"
          className="text-[20px] font-bold text-sky-950 dark:text-sky-100"
        >
          午後の出勤打刻をお願いします
        </p>
        <p className="mt-1 text-[14px] text-sky-900/80 dark:text-sky-200/80">
          {workDate ? `${workDate} · ` : ""}
          {staffName}
          {" · 午前休"}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">
          {AFTERNOON_CLOCK_IN_FROM_JST}
          を過ぎています。午前休のため、午後の出勤打刻を行ってください。
        </p>

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

      <div className="shrink-0 flex flex-col gap-2 border-t border-sky-200 bg-sky-50 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-sky-800 dark:bg-slate-900">
        <button
          type="button"
          disabled={submitting || Boolean(feedback)}
          onClick={() => void punchIn()}
          className="w-full rounded-xl bg-sky-600 py-3.5 text-center text-[16px] font-bold text-white shadow-md transition-colors active:bg-sky-700 disabled:opacity-50 dark:bg-sky-700 dark:active:bg-sky-800"
        >
          {submitting ? "打刻中…" : "出勤打刻する"}
        </button>
        <Link
          href="/attendance"
          onClick={() => {
            snoozeAfternoonClockInForSession(staffName);
            onClose();
          }}
          className="w-full rounded-xl border border-sky-300 bg-white py-3.5 text-center text-[15px] font-semibold text-slate-800 transition-colors active:bg-sky-50 dark:border-sky-700 dark:bg-slate-800 dark:text-slate-100 dark:active:bg-slate-700"
        >
          勤怠画面で打刻
        </Link>
        <button
          type="button"
          disabled={submitting}
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
