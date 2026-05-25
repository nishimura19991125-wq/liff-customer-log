"use client";

import { useCallback, useEffect, useState } from "react";

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
    <div className="mb-6 flex justify-center gap-3" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <span
          key={i}
          className={`size-4 rounded-full border-2 transition ${
            i < length
              ? "border-sky-400 bg-sky-400"
              : "border-slate-500 bg-transparent"
          }`}
        />
      ))}
    </div>
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
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];
  return (
    <div className="grid max-w-xs grid-cols-3 gap-3">
      {keys.map((k, idx) => {
        if (k === "") {
          return <div key={`empty-${idx}`} />;
        }
        const isBack = k === "⌫";
        return (
          <button
            key={k}
            type="button"
            disabled={disabled}
            onClick={() => (isBack ? onBack() : onDigit(k))}
            className="flex h-16 items-center justify-center rounded-2xl bg-slate-800 text-2xl font-bold text-white shadow-lg ring-1 ring-slate-600 transition active:scale-95 active:bg-slate-700 disabled:opacity-40"
          >
            {k}
          </button>
        );
      })}
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

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-900 px-4 text-white">
      <div className="w-full max-w-md text-center">
        <p className="mb-1 text-sm font-medium text-slate-400">情報確認くん</p>
        <h1 className="mb-2 text-xl font-bold tracking-tight">
          {mode === "waiting"
            ? "事務所承認待ち"
            : mode === "set"
              ? needsInitialSetup
                ? "暗証番号の登録"
                : "新しい暗証番号"
              : "暗証番号入力"}
        </h1>
        {staffName ? (
          <p className="mb-8 text-sm text-slate-400">{staffName}</p>
        ) : (
          <div className="mb-8" />
        )}

        {needsInitialSetup && mode === "set" ? (
          <p className="mb-6 rounded-xl border border-sky-500/40 bg-sky-950/50 px-4 py-3 text-left text-[14px] leading-relaxed text-sky-100">
            名簿の PINコード が未設定です。ご自身で4桁の暗証番号を登録してください（2回入力で確認します）。
          </p>
        ) : null}

        {mode === "waiting" && resetCode ? (
          <div className="mb-8 rounded-2xl border-2 border-amber-400/60 bg-slate-800 px-4 py-6">
            <p className="text-sm text-slate-300">再設定用コード</p>
            <p className="mt-2 font-mono text-5xl font-black tracking-[0.35em] text-amber-300">
              {resetCode}
            </p>
            <p className="mt-4 text-left text-[14px] leading-relaxed text-slate-300">
              事務所へ連絡して、この4桁のコードを伝えて承認してもらってください。承認されると自動で次の画面に進みます。
            </p>
            <p className="mt-3 text-xs text-slate-500">承認状況を確認中…</p>
          </div>
        ) : (
          <>
            {mode === "set" ? (
              <p className="mb-4 text-sm text-slate-400">
                {setStep === "enter"
                  ? "新しい4桁の暗証番号を入力"
                  : "もう一度同じ番号を入力"}
              </p>
            ) : null}
            <PinDots length={activeLen} />
            {error ? (
              <p className="mb-4 text-sm font-semibold text-rose-400">{error}</p>
            ) : (
              <div className="mb-4 h-5" />
            )}
            <div className="flex justify-center">
              <NumPad
                onDigit={pushDigit}
                onBack={backspace}
                disabled={busy || mode === "waiting"}
              />
            </div>
          </>
        )}

        {mode === "verify" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void startReset()}
            className="mt-8 text-[14px] font-semibold text-sky-400 underline-offset-2 hover:underline disabled:opacity-50"
          >
            暗証番号を忘れた方はこちら
          </button>
        ) : null}

        {mode === "waiting" ? (
          <button
            type="button"
            className="mt-6 text-sm text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
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
