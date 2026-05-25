"use client";

import useSWR, { type SWRConfiguration, type SWRResponse } from "swr";

import {
  liffAuthedJsonFetch,
  LIFF_SWR_DEFAULT_OPTIONS,
  type LiffSwrError,
} from "@/lib/liff-swr";

type LiffSwrKey = readonly [path: string, token: string];

/**
 * LIFF idToken 付き API 用 SWR（メモリキャッシュのみ）。
 * path が null のときはフェッチしない。
 */
export function useLiffSwr<T>(
  path: string | null,
  idToken: string | null,
  config?: Partial<SWRConfiguration<T, LiffSwrError>>,
): SWRResponse<T, LiffSwrError> {
  const key: LiffSwrKey | null =
    path && idToken ? ([path, idToken] as const) : null;

  return useSWR<T, LiffSwrError>(
    key,
    ([url, token]: LiffSwrKey) => liffAuthedJsonFetch<T>(url, token),
    {
      ...LIFF_SWR_DEFAULT_OPTIONS,
      ...config,
    },
  );
}
