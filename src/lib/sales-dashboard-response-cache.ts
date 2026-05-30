import "server-only";

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
  payload: SalesDashboardPayload;
};
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<SalesDashboardPayload | null>>();

function cacheTtlMs(): number {
  const raw = process.env.SALES_DASHBOARD_CACHE_SECONDS?.trim();
  const sec = raw ? Number(raw) : 180;
  if (!Number.isFinite(sec)) return 180_000;
  return Math.min(900, Math.max(60, sec)) * 1000;
}

function cacheKey(periodKey: SalesDashboardPeriodKey): string {
  return JSON.stringify({
    v: 1,
    period: periodKey,
    pt: salesDashboardPtAppId() ?? "",
    contract: salesDashboardContractAppId() ?? "",
    apo: salesDashboardApoAppId() ?? "",
  });
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
        store.set(key, { expiresAt: Date.now() + ttl, payload });
      }
      return payload;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}
