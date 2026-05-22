import "server-only";

import {
  findCustomerInfoPendingRecords,
  type CustomerInfoContinueShortcutHit,
} from "@/lib/customer-info-continue-shortcut";

type PendingCacheEntry = {
  expiresAt: number;
  hits: CustomerInfoContinueShortcutHit[];
};

const store = new Map<string, PendingCacheEntry>();
const inflight = new Map<string, Promise<CustomerInfoContinueShortcutHit[]>>();

function pendingCacheTtlMs(): number {
  const raw = process.env.CUSTOMER_INFO_PENDING_CACHE_TTL_MS?.trim();
  const n = raw ? Number(raw) : 45_000;
  if (!Number.isFinite(n) || n < 0) return 45_000;
  return Math.min(300_000, Math.floor(n));
}

function cacheKey(boundStaffName: string): string {
  return boundStaffName.normalize("NFKC").trim();
}

export function invalidateCustomerInfoPendingCache(): void {
  store.clear();
  inflight.clear();
}

export async function findCustomerInfoPendingRecordsCached(
  boundStaffName: string,
): Promise<CustomerInfoContinueShortcutHit[]> {
  const ttl = pendingCacheTtlMs();
  if (ttl <= 0) {
    return findCustomerInfoPendingRecords(boundStaffName);
  }

  const key = cacheKey(boundStaffName);
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.hits.map((h) => ({ ...h }));
  }

  const pending = inflight.get(key);
  if (pending) return pending.then((rows) => rows.map((h) => ({ ...h })));

  const promise = (async () => {
    try {
      const hits = await findCustomerInfoPendingRecords(boundStaffName);
      store.set(key, {
        expiresAt: Date.now() + ttl,
        hits,
      });
      return hits;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}
