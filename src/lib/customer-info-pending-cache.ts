import "server-only";

import {
  fetchCustomerInfoPendingSnapshot,
  filterCustomerInfoPendingForStaff,
  type CustomerInfoContinueShortcutHit,
  type CustomerInfoPendingSnapshot,
} from "@/lib/customer-info-continue-shortcut";

/**
 * 未入力一覧（続き入力ショートカット）のサーバ内キャッシュ。
 *
 * ■ 何が問題だったか
 * 以前はキーが担当者名で、TTL も45秒だった。お客様情報アプリの全件走査を
 * **人数ぶん**繰り返すため、10人がホームを開けば10回走る。
 * @pocket の利用制限は **サイト単位で100秒あたり100回**なので、
 * ホーム画面だけで上限を削り切ってしまう。
 *
 * ■ どう変えたか
 * 担当顧客一覧（タスクO-3）と同じ形にした。
 *   - 走査は全社で1回。キーはユーザー非依存の固定値
 *   - 保存するのは**絞り込み前の候補行**（絞り込みに使う3列の生値のみ）
 *   - 担当者での絞り込みは取り出した後に filterCustomerInfoPendingForStaff で行う
 *   - TTL は既定10分
 *
 * ■ キー設計（Phase 0 §6）
 * **絞り込み済みの結果をユーザー非依存キーで保存してはならない。**
 * このファイルが持つのは candidates（全件）だけで、
 * 誰向けかの判定結果は一切保存しない。
 */

type PendingCacheEntry = {
  expiresAt: number;
  snapshot: CustomerInfoPendingSnapshot;
};

/** 既定10分。担当顧客一覧と揃えている */
const DEFAULT_TTL_MS = 600_000;

/**
 * ★ ユーザー非依存キー。**絞り込み前の全件だけ**を入れる。
 * 担当者で絞った結果をここへ入れてはならない。
 */
const PENDING_ALL_CACHE_KEY = "all";

const store = new Map<string, PendingCacheEntry>();
const inflight = new Map<string, Promise<CustomerInfoPendingSnapshot>>();

function pendingCacheTtlMs(): number {
  const raw = process.env.CUSTOMER_INFO_PENDING_CACHE_TTL_MS?.trim();
  const n = raw ? Number(raw) : DEFAULT_TTL_MS;
  if (!Number.isFinite(n) || n < 0) return DEFAULT_TTL_MS;
  return Math.min(DEFAULT_TTL_MS, Math.floor(n));
}

/** 保存・書類アップロード後などに呼ぶ（一覧に古い案件を残さないため） */
export function invalidateCustomerInfoPendingCache(): void {
  store.clear();
  inflight.clear();
}

/** 絞り込み前の全件を、ユーザー非依存キーで共有する */
async function getCachedCustomerInfoPendingSnapshot(): Promise<CustomerInfoPendingSnapshot> {
  const ttl = pendingCacheTtlMs();
  if (ttl <= 0) {
    return fetchCustomerInfoPendingSnapshot();
  }

  const now = Date.now();
  const hit = store.get(PENDING_ALL_CACHE_KEY);
  if (hit && hit.expiresAt > now) return hit.snapshot;

  const pending = inflight.get(PENDING_ALL_CACHE_KEY);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const snapshot = await fetchCustomerInfoPendingSnapshot();
      store.set(PENDING_ALL_CACHE_KEY, {
        expiresAt: Date.now() + ttl,
        snapshot,
      });
      return snapshot;
    } finally {
      inflight.delete(PENDING_ALL_CACHE_KEY);
    }
  })();

  inflight.set(PENDING_ALL_CACHE_KEY, promise);
  return promise;
}

export async function findCustomerInfoPendingRecordsCached(
  boundStaffName: string,
): Promise<CustomerInfoContinueShortcutHit[]> {
  const snapshot = await getCachedCustomerInfoPendingSnapshot();
  // 絞り込みは取り出した後。結果はキャッシュへ戻さない（Phase 0 §6）
  return filterCustomerInfoPendingForStaff(snapshot, boundStaffName);
}
