"use client";

import { refreshLiffIdToken } from "@/lib/liff-session";

/**
 * 工事カレンダーの送信まわりで共通に使うクライアント側ヘルパ。
 *
 * 元は liff-calendar-month-page.tsx にあったが、新規登録の
 * 「未定案件を割り当て」（タスクS）でも同じ扱いが要るので切り出した。
 * 中身は変えていない。
 */

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID?.trim();

export function calendarSubmitCatchMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (
    e instanceof TypeError ||
    /failed to fetch|networkerror|load failed|network/i.test(msg)
  ) {
    return "通信に失敗しました。処理に時間がかかりすぎた可能性があります。工事アプリに登録されている場合はカレンダーを更新して確認してください。";
  }
  return msg.trim() || "通信に失敗しました";
}

/** 送信直前に ID トークンを取り直す。取れなければセッション切れ扱い */
export async function idTokenForConstructionSubmit(
  current: string | null,
  onSessionExpired?: () => void,
): Promise<string | null> {
  if (LIFF_ID) {
    const fresh = await refreshLiffIdToken(LIFF_ID);
    if (!fresh) {
      onSessionExpired?.();
      return null;
    }
    return fresh;
  }
  return current;
}
