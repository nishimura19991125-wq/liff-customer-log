"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DailyOmikujiModal } from "@/components/daily-omikuji-modal";
import type { DailyFortuneView } from "@/lib/home-business-fortune";
import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";

type FlowStep = "omikuji" | "attendance";

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

function DailyAttendanceStep({
  idToken,
  staffName,
  onComplete,
}: {
  idToken: string;
  staffName: string;
  onComplete: () => void;
}) {
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
      setFeedback(`出勤を登録しました（${formatDisplayTime(data.clockIn)}）`);
      window.setTimeout(onComplete, 900);
    } catch {
      setError("出勤登録に失敗しました");
    } finally {
      setSubmitting(false);
    }
  }, [idToken, onComplete, submitting]);

  const skipAttendance =
    preview &&
    (preview.configured === false ||
      preview.disabled ||
      preview.needsStaffBind);
  const skippedRef = useRef(false);

  useEffect(() => {
    if (!loading && skipAttendance && !skippedRef.current) {
      skippedRef.current = true;
      onComplete();
    }
  }, [loading, skipAttendance, onComplete]);

  if (loading || skipAttendance) {
    return (
      <div
        className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label="勤怠登録"
      >
        <p className="rounded-xl bg-white px-5 py-4 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          勤怠情報を確認しています…
        </p>
      </div>
    );
  }

  const alreadyClockedIn = Boolean(preview?.clockIn);

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="daily-attendance-title"
    >
      <div className="relative w-full max-w-sm">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-4 py-3 text-center dark:border-slate-700">
            <p className="text-xs font-medium tracking-widest text-slate-500 dark:text-slate-400">
              本日の勤怠
            </p>
            <p
              id="daily-attendance-title"
              className="mt-0.5 text-sm font-semibold text-slate-800 dark:text-slate-100"
            >
              {staffName}さん
            </p>
          </div>

          <div className="px-5 py-6">
            {error ? (
              <p className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-center text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
                {error}
              </p>
            ) : null}

            {alreadyClockedIn ? (
              <div className="text-center">
                <p className="text-[15px] font-semibold text-slate-800 dark:text-slate-100">
                  本日は出勤済みです（{formatDisplayTime(preview?.clockIn)}）
                </p>
                <p className="mt-2 text-[13px] text-slate-500 dark:text-slate-400">
                  @pocket の勤怠に反映されています
                </p>
              </div>
            ) : (
              <>
                <p className="mb-5 text-center text-[14px] leading-relaxed text-slate-600 dark:text-slate-300">
                  本日は出勤ですか？休みですか？
                </p>
                <div className="flex flex-col gap-3">
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
                    onClick={onComplete}
                    className="w-full rounded-xl border-2 border-slate-300 bg-white py-3.5 text-[15px] font-bold text-slate-800 shadow-sm transition-colors active:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:active:bg-slate-700"
                  >
                    休みにする
                  </button>
                </div>
                <p className="mt-3 text-center text-[12px] text-slate-500 dark:text-slate-400">
                  休みの場合は勤怠への登録は行いません
                </p>
              </>
            )}

            {feedback ? (
              <p className="mt-4 text-center text-[13px] font-medium text-emerald-700 dark:text-emerald-400">
                {feedback}
              </p>
            ) : null}
          </div>

          <div className="border-t border-slate-100 px-4 py-4 dark:border-slate-700">
            <button
              type="button"
              onClick={onComplete}
              disabled={submitting}
              className="w-full rounded-xl bg-slate-800 py-3 text-sm font-bold text-white transition-colors active:bg-slate-900 disabled:opacity-50 dark:bg-slate-700 dark:active:bg-slate-600"
            >
              {alreadyClockedIn || feedback ? "閉じる" : "あとで登録する"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DailyOmikujiFlow({
  fortune,
  staffName,
  idToken,
  onComplete,
}: DailyOmikujiFlowProps) {
  const [step, setStep] = useState<FlowStep>("omikuji");

  if (step === "omikuji") {
    return (
      <DailyOmikujiModal
        fortune={fortune}
        onNext={() => setStep("attendance")}
        onSkip={onComplete}
      />
    );
  }

  return (
    <DailyAttendanceStep
      idToken={idToken}
      staffName={staffName}
      onComplete={onComplete}
    />
  );
}
