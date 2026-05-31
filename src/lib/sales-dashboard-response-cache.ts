import "server-only";

import { isPocketHttpRateLimitError } from "@/lib/atpocket";
import type { SalesDashboardPayload } from "@/lib/sales-dashboard-data";
import { buildSalesDashboardPayload } from "@/lib/sales-dashboard-data";
import type { SalesDashboardPeriodKey } from "@/lib/sales-dashboard-period";
import {
  salesDashboardApoAppId,
  salesDashboardContractAppId,
  salesDashboardPtAppId,
} from "@/lib/sales-dashboard-fields";

type Entry = {
  expiresAt: number;
  staleUntil: number;
  payload: SalesDashboardPayload;
};
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<SalesDashboardPayload | null>>();

/** 429 時に期限切れ TTL 後も返せる猶予（カレンダーと同様） */
const SALES_DASHBOARD_STALE_SERVE_MS = 6 * 60 * 60 * 1000;

function cacheTtlMs(): number {
  const raw = process.env.SALES_DASHBOARD_CACHE_SECONDS?.trim();
  const sec = raw ? Number(raw) : 300;
  if (!Number.isFinite(sec)) return 300_000;
  return Math.min(900, Math.max(60, sec)) * 1000;
}

function cacheKey(periodKey: SalesDashboardPeriodKey): string {
  return JSON.stringify({
    v: 3,
    period: periodKey,
    pt: salesDashboardPtAppId() ?? "",
    contract: salesDashboardContractAppId() ?? "",
    apo: salesDashboardApoAppId() ?? "",
  });
}

export function getStaleSalesDashboardCore(
  periodKey: SalesDashboardPeriodKey,
): SalesDashboardPayload | null {
  const hit = store.get(cacheKey(periodKey));
  if (!hit || Date.now() > hit.staleUntil) return null;
  return hit.payload;
}

export function getAnyStaleSalesDashboardCore(): SalesDashboardPayload | null {
  const now = Date.now();
  let best: Entry | null = null;
  for (const entry of store.values()) {
    if (entry.staleUntil <= now) continue;
    if (!best || entry.staleUntil > best.staleUntil) {
      best = entry;
    }
  }
  return best?.payload ?? null;
}

/** 全社員共通の集計結果（isSelf は未付与・API で個人化） */
export async function getOrComputeSalesDashboardCore(
  periodKey: SalesDashboardPeriodKey,
): Promise<SalesDashboardPayload | null> {
  const key = cacheKey(periodKey);
  const ttl = cacheTtlMs();
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.payload;

  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    try {
      const payload = await buildSalesDashboardPayload("", periodKey);
      if (payload) {
        const savedAt = Date.now();
        store.set(key, {
          expiresAt: savedAt + ttl,
          staleUntil: savedAt + ttl + SALES_DASHBOARD_STALE_SERVE_MS,
          payload,
        });
      }
      return payload;
    } catch (e) {
      if (isPocketHttpRateLimitError(e)) {
        const stale =
          getStaleSalesDashboardCore(periodKey) ??
          getAnyStaleSalesDashboardCore();
        if (stale) {
          console.warn(
            "[sales-dashboard-response-cache] serving stale payload after 429",
            periodKey,
          );
          return {
            ...stale,
            rateLimited: true,
            dashboardStale: true,
          };
        }
      }
      throw e;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}
