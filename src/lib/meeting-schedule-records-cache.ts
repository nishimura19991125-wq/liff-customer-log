import "server-only";

import type { AtPocketFetchAuth, AtPocketRecordRow } from "@/lib/atpocket";
import { fetchSalesDashboardRecordPages } from "@/lib/sales-dashboard-list-fetch";

/**
 * 商談進捗（アポ取得情報連携アプリ）の全件を、サーバ内で共有するキャッシュ。
 *
 * ■ なぜ必要か
 * この一覧はホーム画面で必ず呼ばれるのに、キャッシュも同時実行の合流も
 * 無かった。@pocket の利用制限は **サイト単位で100秒あたり100回**なので、
 * 「人数 × ホームで並列に走るルート数」でそのまま増える。
 * アポアプリは約1,500件＝2ページなので、10人が同時に開くと
 * これだけで20リクエスト飛んでいた。
 *
 * ■ キー設計（Phase 0 §6）
 * キーは **アプリID と要求フィールドの CSV だけ**で作る。
 * **担当者名は入れない。保存するのは絞り込み前の生レコードのみ。**
 * 担当者で絞った結果をこのキーで保存してはならない。
 * 絞り込み（recordMatchesStaff）は取り出した後に呼び出し側が行う。
 *
 * scope=day と scope=list は同じフィールド CSV を要求するため、
 * 1エントリを共有する（従来は2リクエストだった分も1回にまとまる）。
 *
 * ■ 保存直後の扱い
 * 見積ステータス・商談日時を更新したら invalidate を呼ぶこと。
 * 呼ばないと画面が最大 TTL の間だけ古い値を出す。
 */

type Entry = {
  expiresAt: number;
  records: AtPocketRecordRow[];
};

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<AtPocketRecordRow[]>>();

/** 既定10分。担当顧客一覧（タスクO-3）と同じ考え方で揃えている */
const DEFAULT_TTL_SECONDS = 600;

function cacheTtlMs(): number {
  const raw = process.env.MEETING_SCHEDULE_CACHE_SECONDS?.trim();
  const sec = raw ? Number(raw) : DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(sec)) return DEFAULT_TTL_SECONDS * 1000;
  // 0 を許すと毎回取りに行って上限に当たるので下限を設ける
  return Math.min(3600, Math.max(60, sec)) * 1000;
}

/**
 * ★ ユーザー非依存キー。担当者名は含めない。
 * フィールド CSV を含めるのは、列構成が変わったら作り直すため。
 */
function cacheKey(apoAppId: string, fieldsCsv: string): string {
  return JSON.stringify({ v: 1, app: apoAppId.trim(), fields: fieldsCsv });
}

/** 見積ステータス・商談日時を更新したあとに呼ぶ（古い一覧を出さないため） */
export function invalidateMeetingScheduleRecordsCache(): void {
  store.clear();
  inflight.clear();
}

/** 絞り込み前の全件。担当者での絞り込みは呼び出し側で行う */
export async function fetchMeetingScheduleRecordsCached(
  apoAppId: string,
  fieldsCsv: string,
  listAuths: AtPocketFetchAuth[],
  ctx: { operation: string; appEnv: string },
): Promise<AtPocketRecordRow[]> {
  const ttl = cacheTtlMs();
  const key = cacheKey(apoAppId, fieldsCsv);

  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.records;

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const records = await fetchSalesDashboardRecordPages(
        apoAppId,
        fieldsCsv,
        listAuths,
        ctx,
      );
      store.set(key, { expiresAt: Date.now() + ttl, records });
      return records;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}
