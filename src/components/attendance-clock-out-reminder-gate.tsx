"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AttendanceClockOutReminderAlert } from "@/components/attendance-clock-out-reminder-alert";
import {
  clearClockOutReminderSnooze,
  isClockOutReminderSnoozed,
  needsClockOutReminder,
  type ClockOutReminderPreview,
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
  const [preview, setPreview] = useState<ClockOutReminderPreview | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(async () => {
    if (!active || suppressed) return;
    if (pathname === "/attendance") return;
    if (dismissed || isClockOutReminderSnoozed()) return;
    try {
      const res = await fetch("/api/attendance", {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as ClockOutReminderPreview;
      if (needsClockOutReminder(data)) {
        setPreview(data);
        return;
      }
      clearClockOutReminderSnooze();
      setPreview(null);
    } catch {
      // ignore
    }
  }, [active, dismissed, idToken, pathname, suppressed]);

  useEffect(() => {
    if (suppressed) return;
    if (pathname === "/attendance") {
      setDismissed(true);
      setPreview(null);
      return;
    }
    void check();
  }, [check, pathname, suppressed]);

  const visible = Boolean(
    preview?.clockIn && !preview.clockOut && !dismissed && !suppressed,
  );

  useEffect(() => {
    onVisibleChange?.(visible);
  }, [onVisibleChange, visible]);

  if (suppressed || pathname === "/attendance") return null;
  if (!visible || !preview?.clockIn) return null;

  return (
    <AttendanceClockOutReminderAlert
      idToken={idToken}
      staffName={preview.staffName}
      workDate={preview.workDate}
      clockIn={preview.clockIn}
      onClose={() => {
        setDismissed(true);
        setPreview(null);
      }}
    />
  );
}
