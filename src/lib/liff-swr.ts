import type { SWRConfiguration } from "swr";

import { isLineSessionExpiredPayload } from "@/lib/line-auth-codes";

/** @pocket / 社内API 応答用。永続ストレージには保存しない（SWR メモリキャッシュのみ） */
export class LiffSwrError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "LiffSwrError";
    this.status = status;
    this.body = body;
  }
}

export function isLiffSwrError(e: unknown): e is LiffSwrError {
  return e instanceof LiffSwrError;
}

export function isLiffSwrSessionExpired(e: unknown): boolean {
  if (!isLiffSwrError(e)) return false;
  if (e.status === 401 && isLineSessionExpiredPayload(e.body)) return true;
  return e.message === "session-expired";
}

/**
 * LIFF 認証付き JSON 取得。
 * localStorage / sessionStorage には一切書き込まない。
 */
export async function liffAuthedJsonFetch<T>(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (isLineSessionExpiredPayload(body)) {
    throw new LiffSwrError("session-expired", 401, body);
  }

  if (!res.ok) {
    const msg =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : res.status === 429
          ? "アクセスが集中しています。少し待ってから再度お試しください。"
          : `リクエストに失敗しました（${res.status}）`;
    throw new LiffSwrError(msg, res.status, body);
  }

  return body as T;
}

/** SWR キー: [path, idToken] — トークン更新時のみキャッシュを分離 */
export type LiffSwrKey = readonly [path: string, token: string];

/**
 * デフォルト SWR 設定（メモリ内 Stale-While-Revalidate）。
 * provider / persist 等の永続化は使わない。
 */
/** 一覧・カレンダー等（メモリ内のみ・localStorage 不使用） */
export const LIFF_SWR_DEFAULT_OPTIONS: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  revalidateIfStale: true,
  dedupingInterval: 120_000,
  focusThrottleInterval: 120_000,
  keepPreviousData: true,
  errorRetryCount: 1,
};

/** 営業ダッシュボード（サーバー共有キャッシュと揃えた間隔） */
export const LIFF_SWR_DASHBOARD_OPTIONS: SWRConfiguration = {
  ...LIFF_SWR_DEFAULT_OPTIONS,
  dedupingInterval: 180_000,
  focusThrottleInterval: 180_000,
};

/** 工事カレンダー（月単位・空枠の鮮度優先。ダッシュボード等とは別設定） */
export const LIFF_SWR_CALENDAR_OPTIONS: SWRConfiguration = {
  ...LIFF_SWR_DEFAULT_OPTIONS,
  dedupingInterval: 60_000,
  focusThrottleInterval: 60_000,
};
