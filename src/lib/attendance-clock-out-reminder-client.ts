import { jstDateKey } from "@/lib/missing-documents-cache";

export const CLOCK_OUT_REMINDER_FROM_JST = "18:30";

export type ClockOutReminderPreview = {
  configured?: boolean;
  disabled?: boolean;
  needsStaffBind?: boolean;
  clockIn?: string | null;
  clockOut?: string | null;
  canClockOut?: boolean;
  staffName?: string;
  workDate?: string;
};

export function isAfterClockOutReminderTimeJst(now = new Date()): boolean {
  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return hm >= CLOCK_OUT_REMINDER_FROM_JST;
}

export function needsClockOutReminder(
  status: ClockOutReminderPreview,
  now = new Date(),
): boolean {
  if (!isAfterClockOutReminderTimeJst(now)) return false;
  if (
    status.disabled ||
    status.needsStaffBind ||
    status.configured === false
  ) {
    return false;
  }
  return Boolean(status.clockIn && !status.clockOut);
}

function snoozeStorageKey(): string {
  return `attendance-clock-out-reminder-snoozed:${jstDateKey()}`;
}

export function snoozeClockOutReminderForSession(): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(snoozeStorageKey(), "1");
}

export function isClockOutReminderSnoozed(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(snoozeStorageKey()) === "1";
}

export function clearClockOutReminderSnooze(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(snoozeStorageKey());
}
