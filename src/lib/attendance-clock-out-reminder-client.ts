import { DAILY_OMIKUJI_FROM_JST } from "@/lib/daily-omikuji-shown";
import { isAtOrAfterJstHm, msUntilJstDateHm } from "@/lib/jst-hm";
import { jstDateKey } from "@/lib/missing-documents-cache";

export const CLOCK_OUT_REMINDER_FROM_JST = "18:30";

const PENDING_STORAGE_KEY = "attendance-clock-out-pending-v1";

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

export type PendingClockOutReminder = {
  staffName: string;
  workDate: string;
  clockIn: string;
};

export function isAfterClockOutReminderTimeJst(now = new Date()): boolean {
  return isAtOrAfterJstHm(CLOCK_OUT_REMINDER_FROM_JST, now);
}

function addCalendarDaysYmd(ymd: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** 退勤未打刻リマインダーを翌日の出勤打刻表示開始（07:00）まで残すか */
export function isBeforeNextDayClockInDisplay(
  workDate: string,
  now = new Date(),
): boolean {
  const today = jstDateKey(now);
  const work = workDate.trim();
  if (!work) return false;
  if (today < work) return false;
  if (today === work) return true;
  const nextDay = addCalendarDaysYmd(work, 1);
  if (!nextDay) return false;
  if (today > nextDay) return false;
  return !isAtOrAfterJstHm(DAILY_OMIKUJI_FROM_JST, now);
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

function readPendingRaw(): PendingClockOutReminder | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PENDING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingClockOutReminder>;
    const staffName = parsed.staffName?.normalize("NFKC").trim() ?? "";
    const workDate = parsed.workDate?.trim() ?? "";
    const clockIn = parsed.clockIn?.trim() ?? "";
    if (!staffName || !workDate || !clockIn) return null;
    return { staffName, workDate, clockIn };
  } catch {
    return null;
  }
}

export function rememberPendingClockOutReminder(
  status: ClockOutReminderPreview,
): void {
  if (typeof window === "undefined") return;
  const staffName = status.staffName?.normalize("NFKC").trim() ?? "";
  const workDate = status.workDate?.trim() ?? "";
  const clockIn = status.clockIn?.trim() ?? "";
  if (!staffName || !workDate || !clockIn) return;
  try {
    const payload: PendingClockOutReminder = { staffName, workDate, clockIn };
    localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function clearPendingClockOutReminder(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(PENDING_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function getActivePendingClockOutReminder(
  now = new Date(),
): PendingClockOutReminder | null {
  const pending = readPendingRaw();
  if (!pending) return null;
  if (!isBeforeNextDayClockInDisplay(pending.workDate, now)) {
    clearPendingClockOutReminder();
    return null;
  }
  return pending;
}

/**
 * API の当日ステータスと pending を合成して、表示すべき退勤リマインダーを返す。
 * 翌日 07:00（出勤打刻表示開始）以降は自動で消える。
 */
export function resolveClockOutReminderToShow(
  status: ClockOutReminderPreview,
  now = new Date(),
): PendingClockOutReminder | null {
  if (
    status.disabled ||
    status.needsStaffBind ||
    status.configured === false
  ) {
    return getActivePendingClockOutReminder(now);
  }

  const pending = readPendingRaw();
  const statusWorkDate = status.workDate?.trim() ?? "";
  // 翌営業日の出勤が既に入っている場合は、前日の退勤リマインダーを終了
  if (
    pending &&
    statusWorkDate &&
    status.clockIn &&
    statusWorkDate !== pending.workDate
  ) {
    clearPendingClockOutReminder();
  }

  if (status.clockIn && status.clockOut) {
    clearPendingClockOutReminder();
    return null;
  }

  if (needsClockOutReminder(status, now)) {
    rememberPendingClockOutReminder(status);
  }

  return getActivePendingClockOutReminder(now);
}

/** 翌日の出勤打刻表示開始（workDate+1 の 07:00）までの残り ms */
export function msUntilPendingClockOutExpires(
  pending: PendingClockOutReminder,
  now = new Date(),
): number | null {
  const nextDay = addCalendarDaysYmd(pending.workDate, 1);
  if (!nextDay) return null;
  return msUntilJstDateHm(nextDay, DAILY_OMIKUJI_FROM_JST, now);
}

export function clearClockOutReminderSnooze(): void {
  clearPendingClockOutReminder();
}
