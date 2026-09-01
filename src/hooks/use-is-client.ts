"use client";

import { useSyncExternalStore } from "react";

/**
 * クライアントで描画されているか。**サーバ側では必ず false。**
 *
 * createPortal は document を要る。SSR の描画で呼ぶと落ちるので、
 * マウントされるまで false を返して描画を見送る。
 *
 * ⚠ useEffect で setState する形は使わない。
 *    「効果の中で同期的に setState するな」の lint に引っかかるうえ、
 *    描画が1回余計に走る。useSyncExternalStore のサーバ用
 *    スナップショットを false に固定すれば、hydration も食い違わない。
 */

/** 値は変わらないので購読しない */
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function useIsClient(): boolean {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
