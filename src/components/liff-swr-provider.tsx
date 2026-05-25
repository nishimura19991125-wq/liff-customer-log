"use client";

import { SWRConfig } from "swr";

import { LIFF_SWR_DEFAULT_OPTIONS } from "@/lib/liff-swr";

/**
 * アプリ全体の SWR 設定。
 * localStorage / sessionStorage へのデータ永続化は行わない（メモリのみ）。
 */
export function LiffSwrProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={LIFF_SWR_DEFAULT_OPTIONS}>{children}</SWRConfig>
  );
}
