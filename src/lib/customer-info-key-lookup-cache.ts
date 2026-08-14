import "server-only";

import { findCustomerInfoRecordIdByUniqueKey } from "@/lib/customer-info-key-lookup";

type KeyLookupEntry = {
  expiresAt: number;
  recordId: string | null;
};

const store = new Map<string, KeyLookupEntry>();
const inflight = new Map<string, Promise<string | null>>();

function keyLookupCacheTtlMs(): number {
  const raw = process.env.CUSTOMER_INFO_KEY_LOOKUP_CACHE_TTL_MS?.trim();
  const n = raw ? Number(raw) : 120_000;
  if (!Number.isFinite(n) || n < 0) return 120_000;
  return Math.min(600_000, Math.floor(n));
}

function cacheKey(fieldId: string, uniqueKey: string): string {
  return `${fieldId.trim()}\u0000${uniqueKey.normalize("NFKC").trim()}`;
}

export function invalidateCustomerInfoKeyLookupCache(): void {
  store.clear();
  inflight.clear();
}

/**
 * この1件だけキャッシュを捨てて引き直す。
 *
 * 「見つかった」の取り違えは更新先を間違えるだけで気づけるが、
 * **「見つからない」の取り違えは新規レコードを増やしてしまい取り返しがつかない**。
 * キャッシュ由来の null（TTL 内に登録されたレコードなど）を信じて
 * createRecord すると、同じ T番号の顧客が二重にできる。
 * そのため null のときだけ、このキャッシュ無しの経路で確認し直す。
 */
export async function refetchCustomerInfoRecordIdByUniqueKey(
  keyFieldSchemaId: string,
  uniqueKey: string,
): Promise<string | null> {
  const key = cacheKey(keyFieldSchemaId, uniqueKey);
  store.delete(key);
  inflight.delete(key);
  return findCustomerInfoRecordIdByUniqueKeyCached(keyFieldSchemaId, uniqueKey);
}

export async function findCustomerInfoRecordIdByUniqueKeyCached(
  keyFieldSchemaId: string,
  uniqueKey: string,
): Promise<string | null> {
  const ttl = keyLookupCacheTtlMs();
  if (ttl <= 0) {
    return findCustomerInfoRecordIdByUniqueKey(keyFieldSchemaId, uniqueKey);
  }

  const key = cacheKey(keyFieldSchemaId, uniqueKey);
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.recordId;

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const recordId = await findCustomerInfoRecordIdByUniqueKey(
        keyFieldSchemaId,
        uniqueKey,
      );
      store.set(key, {
        expiresAt: Date.now() + ttl,
        recordId,
      });
      return recordId;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}
