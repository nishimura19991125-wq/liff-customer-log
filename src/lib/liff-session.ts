"use client";

import liff from "@line/liff";

import { LIFF_PROFILE_CACHE_KEY } from "@/lib/liff-profile-cache-key";

/** ID トークンの exp を確認（期限切れなら true） */
export function isIdTokenExpired(token: string, skewMs = 30_000): boolean {
  try {
    const part = token.split(".")[1];
    if (!part) return false;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = JSON.parse(atob(padded)) as { exp?: number };
    if (typeof json.exp !== "number") return false;
    return Date.now() >= json.exp * 1000 - skewMs;
  } catch {
    return false;
  }
}

export function clearLiffProfileCache(): void {
  try {
    sessionStorage.removeItem(LIFF_PROFILE_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

function redirectUri(): string {
  return window.location.href;
}

/** 期限切れセッションを破棄して LINE ログインへ（画面遷移するため戻り値なし） */
export async function triggerLiffRelogin(liffId: string): Promise<void> {
  clearLiffProfileCache();
  await liff.init({ liffId });
  if (liff.isLoggedIn()) {
    liff.logout();
  }
  liff.login({ redirectUri: redirectUri() });
}

export type LiffInitResult =
  | { status: "ok"; token: string }
  | { status: "redirecting" };

/**
 * LIFF 初期化後に有効な ID トークンを返す。
 * 未ログイン・期限切れのときは login へリダイレクトし redirecting を返す。
 */
export async function initLiffAndGetToken(
  liffId: string,
): Promise<LiffInitResult> {
  await liff.init({ liffId });

  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: redirectUri() });
    return { status: "redirecting" };
  }

  const token = liff.getIDToken();
  if (!token || isIdTokenExpired(token)) {
    clearLiffProfileCache();
    if (liff.isLoggedIn()) {
      liff.logout();
    }
    liff.login({ redirectUri: redirectUri() });
    return { status: "redirecting" };
  }

  return { status: "ok", token };
}
