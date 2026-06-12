/** 暗証番号解除後の「今日のおみくじ」表示済みフラグ（1日1回・JST） */

import { jstDateKey } from "@/lib/missing-documents-cache";

const STORAGE_KEY = "liff-daily-omikuji-shown-v1";
export const DAILY_OMIKUJI_SHOWN_EVENT = "liff-daily-omikuji-shown";

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
