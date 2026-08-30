"use client";

import { useSyncExternalStore } from "react";

import {
  dialogDiagnosticsEnabled,
  dialogScrollLockDisabled,
} from "@/lib/dialog-diagnostics";

/**
 * 診断モードが有効か（クライアント側）。
 *
 * ⚠ **サーバ側では必ず false を返す。**
 *    location.search はサーバに無いので、そのまま読むとサーバとクライアントで
 *    出力が食い違って hydration が壊れる。useSyncExternalStore の
 *    サーバ用スナップショットを false に固定して避ける。
 *
 * 値は URL と環境変数から決まり、途中で変わらない。購読は何もしない。
 * 判定そのものは lib/dialog-diagnostics（純粋関数）に置いてある。
 */

/** 値は変わらないので購読しない */
const subscribe = () => () => {};

/** サーバ側・初回描画のスナップショット。**常に無効** */
const serverSnapshot = () => false;

function readInput() {
  return {
    search: window.location.search,
    envValue: process.env.NEXT_PUBLIC_CALENDAR_DIALOG_DIAGNOSTICS,
  };
}

export function useDialogDiagnostics(): {
  enabled: boolean;
  scrollLockDisabled: boolean;
} {
  const enabled = useSyncExternalStore(
    subscribe,
    () => dialogDiagnosticsEnabled(readInput()),
    serverSnapshot,
  );
  const scrollLockDisabled = useSyncExternalStore(
    subscribe,
    () => dialogScrollLockDisabled(readInput()),
    serverSnapshot,
  );

  return { enabled, scrollLockDisabled };
}
