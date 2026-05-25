/** 書類未回収警告の折りたたみ状態（UIのみ。顧客データは SWR メモリキャッシュに保持） */

const COLLAPSE_DATE_KEY = "liff-home-missing-docs-collapse-date-v1";
const COLLAPSE_SESSION_KEY = "liff-home-missing-docs-collapse-session-v1";

export const MISSING_DOCUMENTS_CACHE_TTL_MS = 10 * 60 * 1000;

export function jstDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(d);
}

export function isMissingDocumentsAlertCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (sessionStorage.getItem(COLLAPSE_SESSION_KEY) === "1") return true;
    return sessionStorage.getItem(COLLAPSE_DATE_KEY) === jstDateKey();
  } catch {
    return false;
  }
}

export function setMissingDocumentsAlertCollapsed(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(COLLAPSE_SESSION_KEY, "1");
    sessionStorage.setItem(COLLAPSE_DATE_KEY, jstDateKey());
  } catch {
    /* ignore */
  }
}

/** トップを離れたとき（画面を開き直すまで展開） */
export function clearMissingDocumentsAlertSessionCollapse(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(COLLAPSE_SESSION_KEY);
  } catch {
    /* ignore */
  }
}
