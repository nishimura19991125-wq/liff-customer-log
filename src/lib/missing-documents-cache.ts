/** トップ画面・書類未回収警告のクライアントキャッシュ（10分） */

export type MissingDocumentAlertItem = {
  recordId: string;
  customerName: string;
};

export type MissingDocumentsCacheEntry = {
  fetchedAt: number;
  items: MissingDocumentAlertItem[];
};

export const MISSING_DOCUMENTS_CACHE_TTL_MS = 10 * 60 * 1000;

const CACHE_STORAGE_KEY = "liff-home-missing-docs-cache-v1";
const COLLAPSE_DATE_KEY = "liff-home-missing-docs-collapse-date-v1";
const COLLAPSE_SESSION_KEY = "liff-home-missing-docs-collapse-session-v1";

export function readMissingDocumentsCache(): MissingDocumentsCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MissingDocumentsCacheEntry;
    if (
      !parsed ||
      typeof parsed.fetchedAt !== "number" ||
      !Array.isArray(parsed.items)
    ) {
      return null;
    }
    if (Date.now() - parsed.fetchedAt > MISSING_DOCUMENTS_CACHE_TTL_MS) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeMissingDocumentsCache(
  items: MissingDocumentAlertItem[],
): void {
  if (typeof window === "undefined") return;
  try {
    const entry: MissingDocumentsCacheEntry = {
      fetchedAt: Date.now(),
      items,
    };
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    /* quota / private mode */
  }
}

export function jstDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(d);
}

export function isMissingDocumentsAlertCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (sessionStorage.getItem(COLLAPSE_SESSION_KEY) === "1") return true;
    return localStorage.getItem(COLLAPSE_DATE_KEY) === jstDateKey();
  } catch {
    return false;
  }
}

export function setMissingDocumentsAlertCollapsed(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(COLLAPSE_SESSION_KEY, "1");
    localStorage.setItem(COLLAPSE_DATE_KEY, jstDateKey());
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
