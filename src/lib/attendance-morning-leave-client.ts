import { jstDateKey } from "@/lib/missing-documents-cache";
import { isAtOrAfterJstHm } from "@/lib/jst-hm";

/** 午前休選択後、午後の出勤打刻を促す開始時刻（JST） */
export const AFTERNOON_CLOCK_IN_FROM_JST = "12:00";

function morningLeaveStorageKey(staffName: string): string {
  const staffKey = staffName.normalize("NFKC").trim();
  return `attendance-morning-leave:${jstDateKey()}|${staffKey}`;
}

function afternoonSnoozeStorageKey(staffName: string): string {
  const staffKey = staffName.normalize("NFKC").trim();
  return `attendance-afternoon-clock-in-snoozed:${jstDateKey()}|${staffKey}`;
}

export function markMorningLeaveForToday(staffName: string): void {
  if (typeof window === "undefined") return;
  const staffKey = staffName.normalize("NFKC").trim();
  if (!staffKey) return;
  try {
    localStorage.setItem(morningLeaveStorageKey(staffKey), "1");
  } catch {
    /* ignore */
  }
}

export function isMorningLeaveMarkedToday(staffName: string): boolean {
  if (typeof window === "undefined") return false;
  const staffKey = staffName.normalize("NFKC").trim();
  if (!staffKey) return false;
  try {
    return localStorage.getItem(morningLeaveStorageKey(staffKey)) === "1";
  } catch {
    return false;
  }
}

export function clearMorningLeaveForToday(staffName: string): void {
  if (typeof window === "undefined") return;
  const staffKey = staffName.normalize("NFKC").trim();
  if (!staffKey) return;
  try {
    localStorage.removeItem(morningLeaveStorageKey(staffKey));
  } catch {
    /* ignore */
  }
}

export function snoozeAfternoonClockInForSession(staffName: string): void {
  if (typeof window === "undefined") return;
  const staffKey = staffName.normalize("NFKC").trim();
  if (!staffKey) return;
  try {
    sessionStorage.setItem(afternoonSnoozeStorageKey(staffKey), "1");
  } catch {
    /* ignore */
  }
}

export function isAfternoonClockInSnoozed(staffName: string): boolean {
  if (typeof window === "undefined") return false;
  const staffKey = staffName.normalize("NFKC").trim();
  if (!staffKey) return false;
  try {
    return sessionStorage.getItem(afternoonSnoozeStorageKey(staffKey)) === "1";
  } catch {
    return false;
  }
}

export function clearAfternoonClockInSnooze(staffName: string): void {
  if (typeof window === "undefined") return;
  const staffKey = staffName.normalize("NFKC").trim();
  if (!staffKey) return;
  try {
    sessionStorage.removeItem(afternoonSnoozeStorageKey(staffKey));
  } catch {
    /* ignore */
  }
}

export type AfternoonClockInPreview = {
  configured?: boolean;
  disabled?: boolean;
  needsStaffBind?: boolean;
  clockIn?: string | null;
  staffName?: string;
  workDate?: string;
};

export function needsAfternoonClockInReminder(
  staffName: string,
  status: AfternoonClockInPreview,
  now = new Date(),
): boolean {
  if (!isAtOrAfterJstHm(AFTERNOON_CLOCK_IN_FROM_JST, now)) return false;
  if (!isMorningLeaveMarkedToday(staffName)) return false;
  if (
    status.disabled ||
    status.needsStaffBind ||
    status.configured === false
  ) {
    return false;
  }
  return !status.clockIn;
}
