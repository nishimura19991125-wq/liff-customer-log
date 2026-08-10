import "server-only";

import { salesDashboardApoAppId, salesDashboardPtAppId } from "@/lib/sales-dashboard-fields";
import type { SalesProgressCore } from "@/lib/sales-progress-data";
import { buildSalesProgressCore } from "@/lib/sales-progress-data";
import type { SalesProgressMonth } from "@/lib/sales-progress-period";
import {
  salesProgressBranchConfig,
  salesTargetAppId,
} from "@/lib/sales-target-fields";

/**
 * 営業進捗のサーバ内キャッシュ（タスクK-4）。
 *
 * 既存の sales-dashboard-response-cache と同じ設計にしている。
 * 既存側のファイルは変更していない。
 *
 * ■ キーに個人が混ざらないこと（Phase 0 §6）
 * キーは対象月とアプリID・支社設定だけで作る。**呼び出し元の氏名は入れない。**
 * ここに保存するのは personalize 前の core（全社・支社別の集計値と、
 * 担当者別の目標・実績）で、本人の数字を取り出すのは route の仕事。
 * personalize 済みの結果をこのキーで保存してはならない。
 *
 * core には担当者別の行が入るためサーバの中だけで使う。クライアントへ
 * そのまま返さないこと。
 */

type Entry = {
  expiresAt: number;
  core: SalesProgressCore;
};

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<SalesProgressCore | null>>();

const DEFAULT_TTL_SECONDS = 300;

function cacheTtlMs(): number {
  const raw = process.env.SALES_PROGRESS_CACHE_SECONDS?.trim();
  const sec = raw ? Number(raw) : DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(sec)) return DEFAULT_TTL_SECONDS * 1000;
  // 既存のダッシュボードと同じ範囲に収める
  return Math.min(900, Math.max(60, sec)) * 1000;
}

function cacheKey(month: SalesProgressMonth): string {
  const branch = salesProgressBranchConfig();
  return JSON.stringify({
    v: 1,
    ym: month.ym,
    target: salesTargetAppId() ?? "",
    pt: salesDashboardPtAppId() ?? "",
    apo: salesDashboardApoAppId() ?? "",
    // 支社の設定を変えたら作り直す
    branches: branch.visibleBranches,
    other: branch.otherLabel,
  });
}

/** 全社員共通の集計（本人分の抽出は呼び出し側で行う） */
export async function getOrComputeSalesProgressCore(
  month: SalesProgressMonth,
): Promise<SalesProgressCore | null> {
  const key = cacheKey(month);
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.core;

  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    try {
      const core = await buildSalesProgressCore(month);
      if (core) {
        store.set(key, { expiresAt: Date.now() + cacheTtlMs(), core });
      }
      return core;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}
