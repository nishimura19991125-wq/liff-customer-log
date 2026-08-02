"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AttendanceClockOutReminderAlert } from "@/components/attendance-clock-out-reminder-alert";
import {
  clearPendingClockOutReminder,
  getActivePendingClockOutReminder,
  msUntilPendingClockOutExpires,
  resolveClockOutReminderToShow,
  type ClockOutReminderPreview,
  type PendingClockOutReminder,
} from "@/lib/attendance-clock-out-reminder-client";

type Props = {
  idToken: string;
  active: boolean;
  suppressed?: boolean;
  onVisibleChange?: (visible: boolean) => void;
};

export function AttendanceClockOutReminderGate({
  idToken,
  active,
  suppressed = false,
  onVisibleChange,
}: Props) {
  const pathname = usePathname();
  const [pending, setPending] = useState<PendingClockOutReminder | null>(null);
  const [tick, setTick] = useState(0);

  const check = useCallback(async () => {
    if (!active || suppressed) return;
    if (pathname === "/attendance") return;
    try {
      const res = await fetch("/api/attendance", {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) {
        setPending(getActivePendingClockOutReminder());
        return;
      }
      const data = (await res.json()) as ClockOutReminderPreview;
      setPending(resolveClockOutReminderToShow(data));
    } catch {
      setPending(getActivePendingClockOutReminder());
    }
  }, [active, idToken, pathname, suppressed]);

  useEffect(() => {
    if (suppressed) return;
    if (pathname === "/attendance") {
      setPending(null);
      return;
    }
    void check();
  }, [check, pathname, suppressed, tick]);

  useEffect(() => {
    if (!active || suppressed) return;
    const current = pending ?? getActivePendingClockOutReminder();
    if (!current) return;
    const wait = msUntilPendingClockOutExpires(current);
    if (wait == null) return;
    const id = window.setTimeout(() => {
      clearPendingClockOutReminder();
      setPending(null);
      setTick((n) => n + 1);
    }, wait + 50);
    return () => window.clearTimeout(id);
  }, [active, pending, suppressed, tick]);

  const visible = Boolean(pending && !suppressed && pathname !== "/attendance");

  useEffect(() => {
    onVisibleChange?.(visible);
  }, [onVisibleChange, visible]);

  if (suppressed || pathname === "/attendance") return null;
  if (!visible || !pending) return null;

  return (
    <AttendanceClockOutReminderAlert
      idToken={idToken}
      staffName={pending.staffName}
      workDate={pending.workDate}
      clockIn={pending.clockIn}
      onClose={() => {
        setPending(getActivePendingClockOutReminder());
      }}
    />
  );
}
