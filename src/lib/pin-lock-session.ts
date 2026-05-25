/** クライアント側 PIN ロックセッション（同一LIFF起動内のみ有効） */

export const PIN_LOCK_TIMEOUT_MS = 15 * 60 * 1000;

const LAST_ACTIVITY_KEY = "liff_pin_last_activity_at";
const APP_BOOT_KEY = "liff_pin_app_boot_id";
const UNLOCK_BOOT_KEY = "liff_pin_unlocked_boot_id";

function storageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function storageRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** このLIFF起動（ページ読み込み）の識別子。再読み込みのたびに新規発行 */
export function beginPinAppBoot(): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  storageSet(APP_BOOT_KEY, id);
  return id;
}

export function getPinAppBootId(): string | null {
  return storageGet(APP_BOOT_KEY);
}

/** LIFF終了・バックグラウンド移行時に呼び、次回起動でPINを必須にする */
export function invalidatePinUnlockOnAppHide(): void {
  storageRemove(LAST_ACTIVITY_KEY);
  storageRemove(UNLOCK_BOOT_KEY);
}

export function clearPinUnlockSession(): void {
  invalidatePinUnlockOnAppHide();
}

export function markPinUnlockSession(): void {
  const boot = getPinAppBootId();
  if (boot) storageSet(UNLOCK_BOOT_KEY, boot);
  storageSet(LAST_ACTIVITY_KEY, String(Date.now()));
}

export function isPinUnlockSessionActive(): boolean {
  const boot = getPinAppBootId();
  const unlockedBoot = storageGet(UNLOCK_BOOT_KEY);
  if (!boot || !unlockedBoot || boot !== unlockedBoot) return false;

  const raw = storageGet(LAST_ACTIVITY_KEY);
  if (!raw) return false;
  const last = Number(raw);
  if (!Number.isFinite(last)) return false;
  return Date.now() - last < PIN_LOCK_TIMEOUT_MS;
}

export function touchPinUnlockSession(): void {
  if (isPinUnlockSessionActive()) {
    storageSet(LAST_ACTIVITY_KEY, String(Date.now()));
  }
}

/** フルリロード（LIFFの再立ち上げ）とみなす */
export function isFreshDocumentLoad(): boolean {
  if (typeof window === "undefined") return true;
  const nav = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  return !nav || nav.type === "navigate" || nav.type === "reload";
}
