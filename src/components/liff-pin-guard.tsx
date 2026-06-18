"use client";

import { useCallback, useEffect, useState } from "react";

import { DailyOmikujiFlow } from "@/components/daily-omikuji-flow";
import { LockScreen } from "@/components/lock-screen";
import { MeetingSetCreatedAlertGate } from "@/components/meeting-set-created-alert-gate";
import {
  markDailyOmikujiShown,
  shouldShowDailyOmikuji,
} from "@/lib/daily-omikuji-shown";
import {
  buildDailyBusinessFortuneView,
  type DailyFortuneView,
} from "@/lib/home-business-fortune";
import { initLiffAndGetToken } from "@/lib/liff-session";
import {
  beginPinAppBoot,
  invalidatePinUnlockOnAppHide,
  isFreshDocumentLoad,
  isPinUnlockSessionActive,
  markPinUnlockSession,
  touchPinUnlockSession,
} from "@/lib/pin-lock-session";
import { fetchStaffApiWithSessionCache } from "@/lib/staff-api-session-cache";

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
  const [omikuji, setOmikuji] = useState<{
    fortune: DailyFortuneView;
    staffName: string;
  } | null>(null);

  const lockApp = useCallback(() => {
    invalidatePinUnlockOnAppHide();
    setPhase("locked");
  }, []);

  const unlockApp = useCallback((staffName: string) => {
    markPinUnlockSession();
    if (staffName && shouldShowDailyOmikuji(staffName)) {
      setOmikuji({
        fortune: buildDailyBusinessFortuneView(staffName),
        staffName,
      });
    }
    setPhase("unlocked");
  }, []);

  const dismissOmikuji = useCallback(() => {
    if (omikuji) {
      markDailyOmikujiShown(omikuji.staffName);
    }
    setOmikuji(null);
  }, [omikuji]);

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

        const { res: staffRes, data: staffData } =
          await fetchStaffApiWithSessionCache(result.token);
        if (cancelled) return;

        if (
          (!staffRes.ok && !staffData.boundStaff?.id) ||
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

        const needsInitialSetup =
          pinData.needsInitialSetup || !pinData.configured;

        setPinStatus({
          enabled: true,
          configured: pinData.configured,
          needsInitialSetup,
          staffName: pinData.staffName ?? staffData.boundStaff.name,
        });

        if (needsInitialSetup || !isPinUnlockSessionActive()) {
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
        onUnlocked={() => unlockApp(pinStatus.staffName ?? "")}
      />
    );
  }

  return (
    <>
      {children}
      {idToken && phase === "unlocked" ? (
        <MeetingSetCreatedAlertGate idToken={idToken} active />
      ) : null}
      {omikuji && idToken ? (
        <DailyOmikujiFlow
          fortune={omikuji.fortune}
          staffName={omikuji.staffName}
          idToken={idToken}
          onComplete={dismissOmikuji}
        />
      ) : null}
    </>
  );
}
