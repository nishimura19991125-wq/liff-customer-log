"use client";

import { useCallback, useEffect, useState } from "react";

import { DailyOmikujiModal } from "@/components/daily-omikuji-modal";
import {
  clearMorningLeaveForToday,
  markMorningLeaveForToday,
} from "@/lib/attendance-morning-leave-client";
import type { DailyFortuneView } from "@/lib/home-business-fortune";
import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";
import { requestMeetingScheduleAlertCheckAfterPunch } from "@/lib/meeting-schedule-pending-set-created-client";

type AttendancePreview = {
  configured: boolean;
  disabled?: boolean;
  needsStaffBind?: boolean;
  clockIn?: string | null;
  configError?: string;
};

type DailyOmikujiFlowProps = {
  fortune: DailyFortuneView;
  staffName: string;
  idToken: string;
  onComplete: () => void;
};

function formatDisplayTime(raw: string | null | undefined): string {
  if (!raw?.trim()) return "—";
  const s = raw.trim().replace("T", " ");
  const m = /(\d{1,2}:\d{2})/.exec(s);
  return m ? m[1]! : s;
}

export function DailyOmikujiFlow({
  fortune,
  staffName,
  idToken,
  onComplete,
}: DailyOmikujiFlowProps) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<AttendancePreview | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/attendance", {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = (await res.json()) as AttendancePreview & {
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "勤怠情報の取得に失敗しました");
          return;
        }
        setPreview(data);
      } catch {
        if (!cancelled) setError("勤怠情報の取得に失敗しました");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idToken]);

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
      const data = (await res.json()) as AttendancePreview & {
        ok?: boolean;
        error?: string;
      };
      if (res.status === 401 && isLineSessionExpiredPayload(data)) {
        setError("LINE のログインが切れました。アプリを開き直してください。");
        return;
      }
      if (!res.ok) {
        if (res.status === 409 && data.clockIn) {
          clearMorningLeaveForToday(staffName);
          requestMeetingScheduleAlertCheckAfterPunch();
          setFeedback(`本日は出勤済みです（${formatDisplayTime(data.clockIn)}）`);
          window.setTimeout(onComplete, 900);
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
      requestMeetingScheduleAlertCheckAfterPunch();
      setFeedback(`出勤を登録しました（${formatDisplayTime(data.clockIn)}）`);
      window.setTimeout(onComplete, 900);
    } catch {
      setError("出勤登録に失敗しました");
    } finally {
      setSubmitting(false);
    }
  }, [idToken, onComplete, staffName, submitting]);

  const chooseDayOff = useCallback(() => {
    clearMorningLeaveForToday(staffName);
    onComplete();
  }, [onComplete, staffName]);

  const chooseMorningLeave = useCallback(() => {
    markMorningLeaveForToday(staffName);
    setFeedback("午前休を記録しました。12:00以降に出勤打刻を表示します");
    window.setTimeout(onComplete, 900);
  }, [onComplete, staffName]);

  const attendanceUnavailable =
    preview &&
    (preview.configured === false ||
      preview.disabled ||
      preview.needsStaffBind);

  const alreadyClockedIn = Boolean(preview?.clockIn);

  const footer = (() => {
    if (loading) {
      return (
        <p className="py-1 text-center text-sm text-amber-900/70 dark:text-amber-200/70">
          勤怠情報を確認しています…
        </p>
      );
    }

    if (attendanceUnavailable) {
      return (
        <div className="space-y-3">
          <p className="text-center text-[13px] leading-relaxed text-amber-900/80 dark:text-amber-200/80">
            勤怠登録は現在ご利用いただけません
          </p>
          <button
            type="button"
            onClick={onComplete}
            className="w-full rounded-xl bg-amber-600 py-3 text-sm font-bold text-white shadow-md transition-colors active:bg-amber-700 dark:bg-amber-700 dark:active:bg-amber-800"
          >
            閉じる
          </button>
        </div>
      );
    }

    if (alreadyClockedIn) {
      return (
        <div className="space-y-3">
          <p className="text-center text-[14px] font-semibold text-slate-800 dark:text-slate-100">
            本日は出勤済みです（{formatDisplayTime(preview?.clockIn)}）
          </p>
          <button
            type="button"
            onClick={onComplete}
            className="w-full rounded-xl bg-amber-600 py-3 text-sm font-bold text-white shadow-md transition-colors active:bg-amber-700 dark:bg-amber-700 dark:active:bg-amber-800"
          >
            閉じる
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {error ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-center text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </p>
        ) : null}

        {feedback ? (
          <p className="text-center text-[13px] font-medium text-emerald-700 dark:text-emerald-400">
            {feedback}
          </p>
        ) : (
          <>
            <p className="text-center text-[14px] font-semibold text-amber-950/90 dark:text-amber-100">
              本日は出勤・休み・午前休のどれですか？
            </p>
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                disabled={submitting}
                onClick={() => void punchIn()}
                className="w-full rounded-xl bg-emerald-600 py-3.5 text-[15px] font-bold text-white shadow-md transition-colors active:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-700 dark:active:bg-emerald-800"
              >
                {submitting ? "登録中…" : "出勤する"}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={chooseDayOff}
                className="w-full rounded-xl border-2 border-amber-700/25 bg-white py-3.5 text-[15px] font-bold text-slate-800 shadow-sm transition-colors active:bg-amber-50 disabled:opacity-50 dark:border-amber-600/30 dark:bg-slate-800 dark:text-slate-100 dark:active:bg-slate-700"
              >
                休みにする
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={chooseMorningLeave}
                className="w-full rounded-xl border-2 border-sky-600/30 bg-sky-50 py-3.5 text-[15px] font-bold text-sky-900 shadow-sm transition-colors active:bg-sky-100 disabled:opacity-50 dark:border-sky-500/40 dark:bg-sky-950/50 dark:text-sky-100 dark:active:bg-sky-900/60"
              >
                午前休にする
              </button>
            </div>
          </>
        )}
      </div>
    );
  })();

  return <DailyOmikujiModal fortune={fortune} footer={footer} />;
}
