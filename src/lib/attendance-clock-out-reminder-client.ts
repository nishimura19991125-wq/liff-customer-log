import { isAtOrAfterJstHm, msUntilJstDateHm } from "@/lib/jst-hm";
import { jstDateKey } from "@/lib/missing-documents-cache";

export const CLOCK_OUT_REMINDER_FROM_JST = "18:30";

/**
 * 退勤未打刻リマインダーを**翌日の何時まで**出し続けるか（JST）。
 * この時刻になったら、前日ぶんのリマインダーは自動で消える。
 *
 * ⚠ **出勤選択モーダルの開始時刻とは別の定数。**
 *    以前は daily-omikuji-shown.ts の DAILY_OMIKUJI_FROM_JST を共有していた
 *    （「出勤選択が出始めたら、前日の退勤リマインダーを消す」という連動で、
 *    どちらも 07:00）。出勤選択の開始を 8:30 に遅らせたときに分けた。
 *    目的が違う。こちらは前日の打刻忘れに気づいてもらうためのもので、
 *    **退勤の打刻忘れは早く気づいたほうがよい**。朝いつまでも出し続けても
 *    直せる人が増えるわけではないので、07:00 のまま据え置いている。
 *
 *    その結果、07:00〜08:30 の間はどちらも出ない。
 */
export const CLOCK_OUT_REMINDER_UNTIL_NEXT_DAY_JST = "07:00";

const PENDING_STORAGE_KEY = "attendance-clock-out-pending-v1";
const SKIPPED_STORAGE_KEY = "attendance-clock-out-skipped-v1";

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

/**
 * 退勤未打刻リマインダーをまだ出してよいか。
 * 勤怠日の当日中と、翌日の CLOCK_OUT_REMINDER_UNTIL_NEXT_DAY_JST（07:00）
 * より前まで残す。07:00 ちょうどで消える。
 *
 * 関数名の「ClockInDisplay」は、終了時刻を出勤選択モーダルの開始時刻と
 * 共有していたころの名残。いまは出勤選択（08:30）とは連動していない
 */
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
  return !isAtOrAfterJstHm(CLOCK_OUT_REMINDER_UNTIL_NEXT_DAY_JST, now);
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

function readSkippedWorkDate(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const workDate = localStorage.getItem(SKIPPED_STORAGE_KEY)?.trim() ?? "";
    return workDate || null;
  } catch {
    return null;
  }
}

/** 「打刻しない」選択。当該勤怠日のリマインドを出さない（翌日出勤表示まで） */
export function markClockOutReminderSkipped(workDate: string): void {
  if (typeof window === "undefined") return;
  const ymd = workDate.trim();
  if (!ymd) return;
  try {
    localStorage.setItem(SKIPPED_STORAGE_KEY, ymd);
    localStorage.removeItem(PENDING_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function clearClockOutReminderSkipped(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(SKIPPED_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function isClockOutReminderSkippedForWorkDate(
  workDate: string,
  now = new Date(),
): boolean {
  const skipped = readSkippedWorkDate();
  if (!skipped) return false;
  if (skipped !== workDate.trim()) {
    // 別日のスキップが残っている場合は掃除
    if (!isBeforeNextDayClockInDisplay(skipped, now)) {
      clearClockOutReminderSkipped();
    }
    return false;
  }
  if (!isBeforeNextDayClockInDisplay(skipped, now)) {
    clearClockOutReminderSkipped();
    return false;
  }
  return true;
}

export function getActivePendingClockOutReminder(
  now = new Date(),
): PendingClockOutReminder | null {
  const pending = readPendingRaw();
  if (!pending) return null;
  if (isClockOutReminderSkippedForWorkDate(pending.workDate, now)) {
    clearPendingClockOutReminder();
    return null;
  }
  if (!isBeforeNextDayClockInDisplay(pending.workDate, now)) {
    clearPendingClockOutReminder();
    return null;
  }
  return pending;
}

/**
 * API の当日ステータスと pending を合成して、表示すべき退勤リマインダーを返す。
 * 翌日 07:00（CLOCK_OUT_REMINDER_UNTIL_NEXT_DAY_JST）以降は自動で消える。
 * 「打刻しない」選択済みの勤怠日は出さない。
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
    clearClockOutReminderSkipped();
  }

  if (status.clockIn && status.clockOut) {
    clearPendingClockOutReminder();
    clearClockOutReminderSkipped();
    return null;
  }

  const skipDate = statusWorkDate || pending?.workDate || "";
  if (skipDate && isClockOutReminderSkippedForWorkDate(skipDate, now)) {
    clearPendingClockOutReminder();
    return null;
  }

  if (needsClockOutReminder(status, now)) {
    rememberPendingClockOutReminder(status);
  }

  return getActivePendingClockOutReminder(now);
}

/**
 * リマインダーが消える時刻（workDate+1 の 07:00）までの残り ms。
 * すでに過ぎていれば null
 */
export function msUntilPendingClockOutExpires(
  pending: PendingClockOutReminder,
  now = new Date(),
): number | null {
  const nextDay = addCalendarDaysYmd(pending.workDate, 1);
  if (!nextDay) return null;
  return msUntilJstDateHm(
    nextDay,
    CLOCK_OUT_REMINDER_UNTIL_NEXT_DAY_JST,
    now,
  );
}

export function clearClockOutReminderSnooze(): void {
  clearPendingClockOutReminder();
}
