"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AttendanceAfternoonClockInAlert } from "@/components/attendance-afternoon-clock-in-alert";
import {
  AFTERNOON_CLOCK_IN_FROM_JST,
  clearAfternoonClockInSnooze,
  clearMorningLeaveForToday,
  isAfternoonClockInSnoozed,
  isMorningLeaveMarkedToday,
  needsAfternoonClockInReminder,
  type AfternoonClockInPreview,
} from "@/lib/attendance-morning-leave-client";
import { msUntilJstHmToday } from "@/lib/jst-hm";

type Props = {
  idToken: string;
  staffName: string;
  active: boolean;
  suppressed?: boolean;
  onVisibleChange?: (visible: boolean) => void;
};

export function AttendanceAfternoonClockInGate({
  idToken,
  staffName,
  active,
  suppressed = false,
  onVisibleChange,
}: Props) {
  const pathname = usePathname();
  const [preview, setPreview] = useState<AfternoonClockInPreview | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [tick, setTick] = useState(0);

  const staffKey = staffName.normalize("NFKC").trim();

  const check = useCallback(async () => {
    if (!active || suppressed || !staffKey) return;
    if (pathname === "/attendance") return;
    if (dismissed || isAfternoonClockInSnoozed(staffKey)) return;
    if (!isMorningLeaveMarkedToday(staffKey)) {
      setPreview(null);
      return;
    }
    try {
      const res = await fetch("/api/attendance", {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as AfternoonClockInPreview;
      if (data.clockIn) {
        clearMorningLeaveForToday(staffKey);
        clearAfternoonClockInSnooze(staffKey);
        setPreview(null);
        return;
      }
      if (needsAfternoonClockInReminder(staffKey, data)) {
        setPreview(data);
        return;
      }
      setPreview(null);
    } catch {
      // ignore
    }
  }, [active, dismissed, idToken, pathname, staffKey, suppressed]);

  useEffect(() => {
    if (!active || suppressed || !staffKey) return;
    if (!isMorningLeaveMarkedToday(staffKey)) return;

    const wait = msUntilJstHmToday(AFTERNOON_CLOCK_IN_FROM_JST);
    if (wait == null) return;
    const id = window.setTimeout(() => setTick((n) => n + 1), wait + 50);
    return () => window.clearTimeout(id);
  }, [active, staffKey, suppressed, tick]);

  useEffect(() => {
    if (suppressed) return;
    if (pathname === "/attendance") {
      setDismissed(true);
      setPreview(null);
      return;
    }
    void check();
  }, [check, pathname, suppressed, tick]);

  const visible = Boolean(
    preview &&
      !preview.clockIn &&
      !dismissed &&
      !suppressed &&
      isMorningLeaveMarkedToday(staffKey),
  );

  useEffect(() => {
    onVisibleChange?.(visible);
  }, [onVisibleChange, visible]);

  if (suppressed || pathname === "/attendance") return null;
  if (!visible || !staffKey) return null;

  return (
    <AttendanceAfternoonClockInAlert
      idToken={idToken}
      staffName={staffKey}
      workDate={preview?.workDate}
      onClose={() => {
        setDismissed(true);
        setPreview(null);
      }}
    />
  );
}
