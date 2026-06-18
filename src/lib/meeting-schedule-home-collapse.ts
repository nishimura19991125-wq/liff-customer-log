/** ホーム商談進捗情報ウィジェットの折りたたみ状態（UIのみ） */

import { jstDateKey } from "@/lib/missing-documents-cache";

const COLLAPSE_DATE_KEY = "liff-home-meeting-schedule-collapse-date-v1";
const COLLAPSE_SESSION_KEY = "liff-home-meeting-schedule-collapse-session-v1";

export function isMeetingScheduleHomeCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (sessionStorage.getItem(COLLAPSE_SESSION_KEY) === "1") return true;
    return sessionStorage.getItem(COLLAPSE_DATE_KEY) === jstDateKey();
  } catch {
    return false;
  }
}

export function setMeetingScheduleHomeCollapsed(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(COLLAPSE_SESSION_KEY, "1");
    sessionStorage.setItem(COLLAPSE_DATE_KEY, jstDateKey());
  } catch {
    /* ignore */
  }
}

/** トップを離れたとき（画面を開き直すまで展開） */
export function clearMeetingScheduleHomeSessionCollapse(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(COLLAPSE_SESSION_KEY);
  } catch {
    /* ignore */
  }
}
