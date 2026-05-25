/** クライアント側 PIN ロックセッション（sessionStorage） */

export const PIN_LOCK_TIMEOUT_MS = 15 * 60 * 1000;

const LAST_ACTIVITY_KEY = "liff_pin_last_activity_at";

export function clearPinUnlockSession(): void {
  try {
    sessionStorage.removeItem(LAST_ACTIVITY_KEY);
  } catch {
    /* ignore */
  }
}

export function markPinUnlockSession(): void {
  try {
    sessionStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export function isPinUnlockSessionActive(): boolean {
  try {
    const raw = sessionStorage.getItem(LAST_ACTIVITY_KEY);
    if (!raw) return false;
    const last = Number(raw);
    if (!Number.isFinite(last)) return false;
    return Date.now() - last < PIN_LOCK_TIMEOUT_MS;
  } catch {
    return false;
  }
}

export function touchPinUnlockSession(): void {
  if (isPinUnlockSessionActive()) {
    markPinUnlockSession();
  }
}
