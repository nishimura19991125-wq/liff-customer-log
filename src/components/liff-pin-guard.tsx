"use client";

import { useCallback, useEffect, useState } from "react";

import { DailyOmikujiFlow } from "@/components/daily-omikuji-flow";
import { AttendanceClockOutReminderGate } from "@/components/attendance-clock-out-reminder-gate";
import { LockScreen } from "@/components/lock-screen";
import { MeetingSetCreatedAlertGate } from "@/components/meeting-set-created-alert-gate";
import {
  markDailyOmikujiShown,
  shouldShowDailyOmikuji,
} from "@/lib/daily-omikuji-shown";
import {
  buildDailyBusinessFortuneView,
  type DailyFortuneBuildContext,
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
  const [boundStaffName, setBoundStaffName] = useState<string | null>(null);
  const [boundStaffFortuneCtx, setBoundStaffFortuneCtx] =
    useState<DailyFortuneBuildContext>({});
  const [pinStatus, setPinStatus] = useState<PinStatus | null>(null);
  const [omikuji, setOmikuji] = useState<{
    fortune: DailyFortuneView;
    staffName: string;
  } | null>(null);
  const [clockOutReminderVisible, setClockOutReminderVisible] = useState(false);

  const openDailyOmikujiIfNeeded = useCallback(
    (staffName: string, fortuneCtx: DailyFortuneBuildContext = {}) => {
      const staffKey = staffName.normalize("NFKC").trim();
      if (!staffKey || !shouldShowDailyOmikuji(staffKey)) return;
      setOmikuji((current) => {
        if (current) return current;
        return {
          fortune: buildDailyBusinessFortuneView(staffKey, fortuneCtx),
          staffName: staffKey,
        };
      });
    },
    [],
  );

  const lockApp = useCallback(() => {
    invalidatePinUnlockOnAppHide();
    setPhase("locked");
  }, []);

  const unlockApp = useCallback(
    (staffName: string) => {
      markPinUnlockSession();
      setBoundStaffName(staffName.normalize("NFKC").trim() || null);
      openDailyOmikujiIfNeeded(staffName, boundStaffFortuneCtx);
      setPhase("unlocked");
    },
    [openDailyOmikujiIfNeeded, boundStaffFortuneCtx],
  );

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

        const staffName = staffData.boundStaff?.name?.normalize("NFKC").trim() ?? "";

        if (
          (!staffRes.ok && !staffData.boundStaff?.id) ||
          !staffData.bindingEnabled ||
          !staffData.boundStaff?.id
        ) {
          setPhase("skip");
          return;
        }

        setBoundStaffName(staffName || null);
        setBoundStaffFortuneCtx({
          department: staffData.boundStaff?.department ?? null,
          staffRole: staffData.boundStaff?.staffRole ?? null,
        });

        const pinRes = await fetch("/api/staff/pin/status", {
          headers: { Authorization: `Bearer ${result.token}` },
        });
        const pinData = (await pinRes.json()) as PinStatus & {
          error?: string;
          staffName?: string;
        };
        if (cancelled) return;

        if (!pinRes.ok || !pinData.enabled) {
          setBoundStaffName(
            (pinData.staffName ?? staffName).normalize("NFKC").trim() || null,
          );
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
    if (phase !== "unlocked" && phase !== "skip") return;
    if (!boundStaffName) return;
    openDailyOmikujiIfNeeded(boundStaffName, boundStaffFortuneCtx);
  }, [phase, boundStaffName, boundStaffFortuneCtx, openDailyOmikujiIfNeeded]);

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      invalidatePinUnlockOnAppHide();
      if (boundStaffName) {
        openDailyOmikujiIfNeeded(boundStaffName, boundStaffFortuneCtx);
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [boundStaffName, boundStaffFortuneCtx, openDailyOmikujiIfNeeded]);

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
      {idToken && (phase === "unlocked" || phase === "skip") ? (
        <MeetingSetCreatedAlertGate
          idToken={idToken}
          active
          suppressed={Boolean(omikuji) || clockOutReminderVisible}
        />
      ) : null}
      {idToken && (phase === "unlocked" || phase === "skip") ? (
        <AttendanceClockOutReminderGate
          idToken={idToken}
          active
          suppressed={Boolean(omikuji)}
          onVisibleChange={setClockOutReminderVisible}
        />
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
