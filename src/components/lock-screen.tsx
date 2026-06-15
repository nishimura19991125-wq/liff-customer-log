"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

type LockMode = "verify" | "waiting" | "set";

type LockScreenProps = {
  staffName: string;
  idToken: string;
  needsInitialSetup: boolean;
  onUnlocked: () => void;
};

const POLL_MS = 3000;

function PinDots({ length }: { length: number }) {
  return (
    <div
      className="mb-6 flex justify-center gap-3 md:mb-4 md:gap-2.5"
      aria-hidden
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <span
          key={i}
          className={`size-4 rounded-full border-2 transition-all duration-300 md:size-3 ${
            i < length
              ? "border-sky-400 bg-sky-400 dark:border-sky-500 dark:bg-sky-500"
              : "border-slate-300 bg-transparent dark:border-slate-600"
          }`}
        />
      ))}
    </div>
  );
}

const NUMPAD_BTN_CLASS =
  "flex size-[4.25rem] shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-3xl font-bold text-slate-800 shadow-md transition-all duration-300 active:bg-slate-100 disabled:pointer-events-none disabled:opacity-40 md:size-14 md:text-2xl lg:size-[3.25rem] lg:text-[1.65rem] dark:border-none dark:bg-slate-800/60 dark:text-slate-100 dark:active:bg-slate-700";

function BackspaceIcon() {
  return (
    <svg
      className="size-7 md:size-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
      <path d="M18 9l-6 6M12 9l6 6" />
    </svg>
  );
}

function NumPadButton({
  label,
  onClick,
  disabled,
  ariaLabel,
}: {
  label: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      className={NUMPAD_BTN_CLASS}
    >
      {label}
    </button>
  );
}

function NumPadSpacer() {
  return (
    <div
      className="size-[4.25rem] shrink-0 md:size-14 lg:size-[3.25rem]"
      aria-hidden
    />
  );
}

function NumPad({
  onDigit,
  onBack,
  disabled,
}: {
  onDigit: (d: string) => void;
  onBack: () => void;
  disabled?: boolean;
}) {
  const row1 = ["1", "2", "3"];
  const row2 = ["4", "5", "6"];
  const row3 = ["7", "8", "9"];

  const renderRow = (digits: string[]) => (
    <div className="flex justify-center gap-5 md:gap-3">
      {digits.map((d) => (
        <NumPadButton
          key={d}
          label={d}
          disabled={disabled}
          ariaLabel={`数字 ${d}`}
          onClick={() => onDigit(d)}
        />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col items-center gap-5 md:gap-3">
      {renderRow(row1)}
      {renderRow(row2)}
      {renderRow(row3)}
      <div className="flex justify-center gap-5 md:gap-3">
        <NumPadSpacer />
        <NumPadButton
          label="0"
          disabled={disabled}
          ariaLabel="数字 0"
          onClick={() => onDigit("0")}
        />
        <NumPadButton
          label={<BackspaceIcon />}
          disabled={disabled}
          ariaLabel="1文字削除"
          onClick={onBack}
        />
      </div>
    </div>
  );
}

export function LockScreen({
  staffName,
  idToken,
  needsInitialSetup,
  onUnlocked,
}: LockScreenProps) {
  const [mode, setMode] = useState<LockMode>(
    needsInitialSetup ? "set" : "verify",
  );
  const [digits, setDigits] = useState("");
  const [confirmDigits, setConfirmDigits] = useState("");
  const [setStep, setSetStep] = useState<"enter" | "confirm">("enter");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetCode, setResetCode] = useState<string | null>(null);

  useEffect(() => {
    if (needsInitialSetup) {
      setMode("set");
      setSetStep("enter");
      setDigits("");
      setConfirmDigits("");
      setError(null);
      setResetCode(null);
    }
  }, [needsInitialSetup]);

  const authHeaders = useCallback(
    () => ({ Authorization: `Bearer ${idToken}` }),
    [idToken],
  );

  const pushDigit = useCallback(
    (d: string) => {
      setError(null);
      if (mode === "set") {
        if (setStep === "enter") {
          setDigits((prev) => (prev.length < 4 ? prev + d : prev));
        } else {
          setConfirmDigits((prev) => (prev.length < 4 ? prev + d : prev));
        }
        return;
      }
      setDigits((prev) => (prev.length < 4 ? prev + d : prev));
    },
    [mode, setStep],
  );

  const backspace = useCallback(() => {
    setError(null);
    if (mode === "set" && setStep === "confirm") {
      setConfirmDigits((prev) => prev.slice(0, -1));
      return;
    }
    setDigits((prev) => prev.slice(0, -1));
  }, [mode, setStep]);

  const submitVerify = useCallback(
    async (pin: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/staff/pin/verify", {
          method: "POST",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ pin }),
        });
        const data = (await res.json()) as {
          error?: string;
          needsInitialSetup?: boolean;
        };
        if (!res.ok) {
          if (data.needsInitialSetup) {
            setMode("set");
            setSetStep("enter");
            setDigits("");
            setConfirmDigits("");
            setError(data.error ?? "暗証番号を登録してください");
            return;
          }
          setError(data.error ?? "暗証番号が正しくありません");
          setDigits("");
          return;
        }
        onUnlocked();
      } catch {
        setError("通信エラーが発生しました");
        setDigits("");
      } finally {
        setBusy(false);
      }
    },
    [authHeaders, onUnlocked],
  );

  const submitSetPin = useCallback(
    async (pin: string, initial: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/staff/pin/set", {
          method: "POST",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            pin,
            mode: initial ? "initial" : "after-approval",
          }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          setError(data.error ?? "登録に失敗しました");
          setDigits("");
          setConfirmDigits("");
          setSetStep("enter");
          return;
        }
        onUnlocked();
      } catch {
        setError("通信エラーが発生しました");
      } finally {
        setBusy(false);
      }
    },
    [authHeaders, onUnlocked],
  );

  useEffect(() => {
    if (needsInitialSetup || mode !== "verify" || digits.length !== 4) return;
    void submitVerify(digits);
  }, [needsInitialSetup, mode, digits, submitVerify]);

  useEffect(() => {
    if (mode !== "set") return;
    if (setStep === "enter" && digits.length === 4) {
      setSetStep("confirm");
      return;
    }
    if (setStep === "confirm" && confirmDigits.length === 4) {
      if (digits !== confirmDigits) {
        setError("暗証番号が一致しません。最初から入力してください");
        setDigits("");
        setConfirmDigits("");
        setSetStep("enter");
        return;
      }
      void submitSetPin(digits, needsInitialSetup);
    }
  }, [
    mode,
    setStep,
    digits,
    confirmDigits,
    needsInitialSetup,
    submitSetPin,
  ]);

  const startReset = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/staff/pin/reset-request", {
        method: "POST",
        headers: authHeaders(),
      });
      const data = (await res.json()) as {
        resetCode?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "リセットの開始に失敗しました");
        return;
      }
      setResetCode(data.resetCode ?? null);
      setMode("waiting");
      setDigits("");
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    if (mode !== "waiting") return;

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch("/api/staff/pin/status", {
          headers: authHeaders(),
        });
        const data = (await res.json()) as {
          resetApproval?: string;
          error?: string;
        };
        if (cancelled || !res.ok) return;
        if (data.resetApproval === "承認済") {
          setMode("set");
          setSetStep("enter");
          setDigits("");
          setConfirmDigits("");
          setError(null);
        }
      } catch {
        /* ignore poll errors */
      }
    };

    void poll();
    const id = window.setInterval(() => {
      void poll();
    }, POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [mode, authHeaders]);

  const activeLen =
    mode === "set" && setStep === "confirm" ? confirmDigits.length : digits.length;

  const screenTitle =
    mode === "waiting" ? "事務所承認待ち" : "暗証番号入力";

  const screenSubtitle =
    mode === "set"
      ? setStep === "confirm"
        ? "もう一度同じ番号を入力"
        : needsInitialSetup
          ? "4桁の暗証番号を登録（2回入力）"
          : "新しい4桁の暗証番号を入力"
      : null;

  return (
    <div className="fixed inset-0 z-[100] flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] text-slate-800 transition-all duration-300 md:py-8 dark:bg-slate-900 dark:text-white">
      <div className="flex w-full max-w-md flex-col items-center justify-center text-center md:max-w-xs">
        <p className="mb-1 text-sm font-medium text-slate-500 md:text-xs dark:text-slate-400">
          情報確認くん
        </p>
        <h1 className="mb-2 text-xl font-bold tracking-tight text-slate-800 md:text-lg dark:text-white">
          {screenTitle}
        </h1>
        {staffName ? (
          <p className="text-sm text-slate-500 md:text-xs dark:text-slate-400">
            {staffName}
          </p>
        ) : null}
        {screenSubtitle ? (
          <p className="mt-2 text-sm text-slate-500 md:mt-1 md:text-xs dark:text-slate-400">
            {screenSubtitle}
          </p>
        ) : null}
        <div className="mb-8 md:mb-5" />

        {mode === "waiting" && resetCode ? (
          <div className="mb-8 rounded-2xl border-2 border-amber-400/60 bg-white px-4 py-6 transition-all duration-300 md:mb-5 md:px-3 md:py-4 dark:border-amber-500/50 dark:bg-slate-800">
            <p className="text-sm text-slate-600 md:text-xs dark:text-slate-300">
              再設定用コード
            </p>
            <p className="mt-2 font-mono text-5xl font-black tracking-[0.35em] text-amber-600 md:text-4xl md:tracking-[0.3em] dark:text-amber-300">
              {resetCode}
            </p>
            <p className="mt-4 text-left text-[14px] leading-relaxed text-slate-600 md:mt-3 md:text-[13px] dark:text-slate-300">
              事務所へ連絡して、この4桁のコードを伝えて承認してもらってください。承認されると自動で次の画面に進みます。
            </p>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              承認状況を確認中…
            </p>
          </div>
        ) : (
          <>
            <PinDots length={activeLen} />
            {error ? (
              <p className="mb-4 text-sm font-semibold text-rose-600 md:mb-3 md:text-xs dark:text-rose-400">
                {error}
              </p>
            ) : (
              <div className="mb-4 h-5 md:mb-3 md:h-4" />
            )}
            <NumPad
              onDigit={pushDigit}
              onBack={backspace}
              disabled={busy || mode === "waiting"}
            />
          </>
        )}

        {mode === "verify" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void startReset()}
            className="mt-8 text-[14px] font-semibold text-sky-600 underline-offset-2 transition-colors duration-300 hover:underline disabled:opacity-50 md:mt-5 md:text-[13px] dark:text-sky-400"
          >
            暗証番号を忘れた方はこちら
          </button>
        ) : null}

        {mode === "waiting" ? (
          <button
            type="button"
            className="mt-6 text-sm text-slate-500 underline-offset-2 transition-colors duration-300 hover:text-slate-700 hover:underline dark:hover:text-slate-300"
            onClick={() => {
              setMode("verify");
              setResetCode(null);
              setError(null);
            }}
          >
            入力画面に戻る
          </button>
        ) : null}
      </div>
    </div>
  );
}
