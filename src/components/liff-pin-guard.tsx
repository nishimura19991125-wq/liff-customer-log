"use client";

import { useCallback, useEffect, useState } from "react";

import { LockScreen } from "@/components/lock-screen";
import { initLiffAndGetToken } from "@/lib/liff-session";
import {
  beginPinAppBoot,
  invalidatePinUnlockOnAppHide,
  isFreshDocumentLoad,
  isPinUnlockSessionActive,
  markPinUnlockSession,
  touchPinUnlockSession,
} from "@/lib/pin-lock-session";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

type PinStatus = {
  enabled: boolean;
  configured: boolean;
  needsInitialSetup: boolean;
  staffName?: string;
};

type GuardPhase =
  | "init"
  | "redirecting"
  | "skip"
  | "locked"
  | "unlocked";

export function LiffPinGuard({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<GuardPhase>("init");
  const [idToken, setIdToken] = useState<string | null>(null);
  const [pinStatus, setPinStatus] = useState<PinStatus | null>(null);

  const lockApp = useCallback(() => {
    invalidatePinUnlockOnAppHide();
    setPhase("locked");
  }, []);

  const unlockApp = useCallback(() => {
    markPinUnlockSession();
    setPhase("unlocked");
  }, []);

  useEffect(() => {
    const onPageHide = () => invalidatePinUnlockOnAppHide();
    const onFreeze = () => invalidatePinUnlockOnAppHide();

    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("freeze", onFreeze as EventListener);

    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("freeze", onFreeze as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!LIFF_ID) {
      setPhase("skip");
      return;
    }

    if (isFreshDocumentLoad()) {
      invalidatePinUnlockOnAppHide();
    }
    beginPinAppBoot();

    let cancelled = false;

    (async () => {
      try {
        const result = await initLiffAndGetToken(LIFF_ID);
        if (cancelled) return;
        if (result.status === "redirecting") {
          setPhase("redirecting");
          return;
        }
        setIdToken(result.token);

        const staffRes = await fetch("/api/staff", {
          headers: { Authorization: `Bearer ${result.token}` },
        });
        const staffData = (await staffRes.json()) as {
          boundStaff?: { id: string; name: string } | null;
          bindingEnabled?: boolean;
        };
        if (cancelled) return;

        if (
          !staffRes.ok ||
          !staffData.bindingEnabled ||
          !staffData.boundStaff?.id
        ) {
          setPhase("skip");
          return;
        }

        const pinRes = await fetch("/api/staff/pin/status", {
          headers: { Authorization: `Bearer ${result.token}` },
        });
        const pinData = (await pinRes.json()) as PinStatus & {
          error?: string;
          staffName?: string;
        };
        if (cancelled) return;

        if (!pinRes.ok || !pinData.enabled) {
          setPhase("skip");
          return;
        }

        setPinStatus({
          enabled: true,
          configured: pinData.configured,
          needsInitialSetup: pinData.needsInitialSetup,
          staffName: pinData.staffName ?? staffData.boundStaff.name,
        });

        if (pinData.needsInitialSetup || !isPinUnlockSessionActive()) {
          setPhase("locked");
        } else {
          setPhase("unlocked");
        }
      } catch {
        if (!cancelled) setPhase("skip");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (phase !== "unlocked") return;

    const onActivity = () => touchPinUnlockSession();
    const events = ["pointerdown", "keydown", "touchstart", "scroll"] as const;
    for (const ev of events) {
      document.addEventListener(ev, onActivity, { passive: true });
    }

    const interval = window.setInterval(() => {
      if (!isPinUnlockSessionActive()) {
        lockApp();
      }
    }, 30_000);

    return () => {
      for (const ev of events) {
        document.removeEventListener(ev, onActivity);
      }
      window.clearInterval(interval);
    };
  }, [phase, lockApp]);

  if (phase === "redirecting" || phase === "init") {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900 text-slate-300">
        <p className="text-sm">読み込み中…</p>
      </div>
    );
  }

  if (phase === "locked" && idToken && pinStatus) {
    return (
      <LockScreen
        staffName={pinStatus.staffName ?? ""}
        idToken={idToken}
        needsInitialSetup={pinStatus.needsInitialSetup}
        onUnlocked={unlockApp}
      />
    );
  }

  return <>{children}</>;
}
