import "server-only";

import { currentYmInJst } from "@/lib/fiscal-year";
import type { SalesDashboardCore } from "@/lib/sales-dashboard-data";
import { buildSalesDashboardCore } from "@/lib/sales-dashboard-data";
import {
  salesDashboardApoAppId,
  salesDashboardContractAppId,
  salesDashboardPtAppId,
} from "@/lib/sales-dashboard-fields";
import { salesProgressBranchConfig } from "@/lib/sales-target-fields";

/**
 * 営業ランキングのサーバ内キャッシュ。
 *
 * ■ 期間をキーに含めない
 * core は**全月ぶん**を持つ。月や年度を切り替えても同じ core から取り出す
 * だけなので、@pocket は叩かない。以前は "current" / "previous" ごとに
 * 別エントリを持っていたが、その必要がなくなった。
 *
 * ■ 月替わりの取り扱い（重要）
 * 期間をキーから落とすと、月が変わった瞬間に古い core が TTL いっぱい
 * （最大30分）居座る。当月の集計が前の月のまま見えるのを避けるため、
 * **JST の現在の年月をキーに混ぜ、さらに core.computedYm と突き合わせる。**
 * 二重にしているのは、キーだけだと 429 時の stale 返却経路
 * （getAnyStaleSalesDashboardCore）が古い月の core を拾えてしまうため。
 *
 * ■ キーに個人を混ぜない
 * core は personalize 前。本人の isSelf を付けるのは route の仕事。
 *
 * ■ 429 の扱い
 * ここでは握り潰さずそのまま投げる。猶予内の古い集計を出すのは route の
 * 役目で、rateLimited / dashboardStale の目印もそちらで付ける。
 * 以前は両方で stale を返していたが、経路が二重になっていた。
 */

type Entry = {
  expiresAt: number;
  staleUntil: number;
  core: SalesDashboardCore;
};
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<SalesDashboardCore | null>>();

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

function cacheKey(): string {
  const branch = salesProgressBranchConfig();
  return JSON.stringify({
    // v6: 期間キーを廃し、全月ぶんの core を1つ持つ形に変えた
    v: 6,
    // 月が変わったら作り直す（当月の集計が前の月のまま残らないように）
    ym: currentYmInJst(),
    pt: salesDashboardPtAppId() ?? "",
    contract: salesDashboardContractAppId() ?? "",
    apo: salesDashboardApoAppId() ?? "",
    // 支社の設定を変えたら作り直す
    branches: branch.visibleBranches,
    other: branch.otherLabel,
  });
}

/** 月替わりをまたいだ core は使わない。キーと二重で見る */
function isCurrentMonthCore(core: SalesDashboardCore): boolean {
  return core.computedYm === currentYmInJst();
}

export function getStaleSalesDashboardCore(): SalesDashboardCore | null {
  const hit = store.get(cacheKey());
  if (!hit || Date.now() > hit.staleUntil) return null;
  if (!isCurrentMonthCore(hit.core)) return null;
  return hit.core;
}

/**
 * キーが変わっていても（アプリID・支社設定の変更など）、まだ猶予内の
 * core があれば返す。429 のときだけ使う最後の手段。
 * **月をまたいだものは返さない。**
 */
export function getAnyStaleSalesDashboardCore(): SalesDashboardCore | null {
  const now = Date.now();
  let best: Entry | null = null;
  for (const entry of store.values()) {
    if (entry.staleUntil <= now) continue;
    if (!isCurrentMonthCore(entry.core)) continue;
    if (!best || entry.staleUntil > best.staleUntil) {
      best = entry;
    }
  }
  return best?.core ?? null;
}

/** 全社員共通の集計（本人分の付与は呼び出し側で行う） */
export async function getOrComputeSalesDashboardCore(
  /** 画面の「更新」。キャッシュを無視して取り直す（呼び出し側で連打を抑えること） */
  forceRefresh = false,
): Promise<SalesDashboardCore | null> {
  const key = cacheKey();
  const now = Date.now();
  const hit = store.get(key);
  if (
    !forceRefresh &&
    hit &&
    hit.expiresAt > now &&
    isCurrentMonthCore(hit.core)
  ) {
    return hit.core;
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const ttl = cacheTtlMs();
  const p = (async () => {
    try {
      const core = await buildSalesDashboardCore();
      if (core) {
        const savedAt = Date.now();
        store.set(key, {
          expiresAt: savedAt + ttl,
          staleUntil: savedAt + ttl + SALES_DASHBOARD_STALE_SERVE_MS,
          core,
        });
      }
      return core;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}
