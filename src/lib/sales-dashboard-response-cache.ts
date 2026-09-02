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

/**
 * 既定30分。
 *
 * @pocket の利用制限は **サイト単位で100秒あたり100回**（API キー単位ではない）。
 * この画面は初回に3アプリを全件走査するため、数人が同時に開くだけで上限に届く。
 * 集計値なので多少古くても業務判断は変わらない、という判断で長くしている。
 * 最新が要るときは画面の「更新」（refresh=1）で取り直せる。
 */
const DEFAULT_TTL_SECONDS = 1800;

function cacheTtlMs(): number {
  const raw = process.env.SALES_DASHBOARD_CACHE_SECONDS?.trim();
  const sec = raw ? Number(raw) : DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(sec)) return DEFAULT_TTL_SECONDS * 1000;
  return Math.min(3600, Math.max(60, sec)) * 1000;
}

function cacheKey(periodKey: SalesDashboardPeriodKey): string {
  return JSON.stringify({
    // v5: ランキング行に branch（所属支社）を足した
    v: 5,
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
  /** 画面の「更新」。キャッシュを無視して取り直す（呼び出し側で連打を抑えること） */
  forceRefresh = false,
): Promise<SalesDashboardPayload | null> {
  const key = cacheKey(periodKey);
  const ttl = cacheTtlMs();
  const now = Date.now();
  const hit = store.get(key);
  if (!forceRefresh && hit && hit.expiresAt > now) return hit.payload;

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
