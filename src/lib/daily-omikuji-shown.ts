/** 暗証番号解除後の「今日のおみくじ」表示済みフラグ（1日1回・JST） */

import { isAtOrAfterJstHm } from "@/lib/jst-hm";
import { jstDateKey } from "@/lib/missing-documents-cache";

const STORAGE_KEY = "liff-daily-omikuji-shown-v1";
export const DAILY_OMIKUJI_SHOWN_EVENT = "liff-daily-omikuji-shown";

/**
 * おみくじ＋出勤選択モーダルの表示開始時刻（JST）。
 *
 * この時刻より前にアプリを開いてもモーダルは出さず、時刻になったら出す
 * （liff-pin-guard.tsx が残り時間でタイマーを掛ける）。
 *
 * ⚠ **退勤未打刻リマインダーを消す時刻とは別の定数。**
 *    以前はこの1つを両方で共有していた（どちらも 07:00）。出勤選択の開始を
 *    8:30 に遅らせるにあたり、目的が違うので分けた。あちらは
 *    attendance-clock-out-reminder-client.ts の
 *    CLOCK_OUT_REMINDER_UNTIL_NEXT_DAY_JST（07:00 のまま）。
 *    共有したままだと、前日の退勤リマインダーが 8:30 まで出続けてしまう。
 */
export const DAILY_OMIKUJI_FROM_JST = "08:30";

export function isAfterDailyOmikujiTimeJst(now = new Date()): boolean {
  return isAtOrAfterJstHm(DAILY_OMIKUJI_FROM_JST, now);
}

function storageValue(staffKey: string): string {
  return `${jstDateKey()}|${staffKey.normalize("NFKC").trim()}`;
}

export function shouldShowDailyOmikuji(staffName: string): boolean {
  if (typeof window === "undefined") return false;
  const staffKey = staffName.normalize("NFKC").trim();
  if (!staffKey) return false;
  try {
    return localStorage.getItem(STORAGE_KEY) !== storageValue(staffKey);
  } catch {
    return false;
  }
}

export function isDailyOmikujiShownToday(staffName: string): boolean {
  return !shouldShowDailyOmikuji(staffName);
}

export function markDailyOmikujiShown(staffName: string): void {
  if (typeof window === "undefined") return;
  const staffKey = staffName.normalize("NFKC").trim();
  if (!staffKey) return;
  try {
    localStorage.setItem(STORAGE_KEY, storageValue(staffKey));
    window.dispatchEvent(new Event(DAILY_OMIKUJI_SHOWN_EVENT));
  } catch {
    /* ignore */
  }
}
