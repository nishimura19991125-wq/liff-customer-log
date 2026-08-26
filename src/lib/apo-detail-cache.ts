import "server-only";

import type { AtPocketRecordRow } from "@/lib/atpocket";

/**
 * 詳細ページで取る1件のレコードを、recordId 単位で短時間だけ持つ。
 *
 * 一覧は全件キャッシュ（meeting-schedule-records-cache）に相乗りしているが、
 * 詳細は必要な列が違うため1件だけ取りに行く。@pocket はサイト単位で
 * 100秒あたり100回の制限があり、戻る/進むや連打でそのまま回数が増えると
 * 429 に近づく。ここで短時間だけ持って回数を抑える。
 *
 * TTL は既定60秒と短め。詳細は「今の値を見る」画面なので、
 * 一覧（10分）ほど長く持つと保存直後の値とずれる。
 */

type Entry = {
  expiresAt: number;
  row: AtPocketRecordRow | null;
};

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<AtPocketRecordRow | null>>();

const DEFAULT_TTL_SECONDS = 60;

function cacheTtlMs(): number {
  const raw = process.env.APO_DETAIL_CACHE_SECONDS?.trim();
  const sec = raw ? Number(raw) : DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(sec)) return DEFAULT_TTL_SECONDS * 1000;
  // 0 を許すと毎回取りに行って上限に当たるので下限を設ける
  return Math.min(600, Math.max(10, sec)) * 1000;
}

/**
 * ★ ユーザー非依存キー。担当者名は含めない。
 * 担当者での絞り込みは取り出した後に呼び出し側が行う
 * （meeting-schedule-records-cache と同じ考え方）。
 */
function cacheKey(appId: string, recordId: string, fieldsCsv: string): string {
  return JSON.stringify({
    v: 1,
    app: appId.trim(),
    record: recordId.trim(),
    fields: fieldsCsv,
  });
}

/** 保存などで値が変わったときに捨てる */
export function invalidateApoDetailCache(): void {
  store.clear();
  inflight.clear();
}

export async function fetchApoDetailRecordCached(
  appId: string,
  recordId: string,
  fieldsCsv: string,
  load: () => Promise<AtPocketRecordRow | null>,
): Promise<AtPocketRecordRow | null> {
  const key = cacheKey(appId, recordId, fieldsCsv);
  const now = Date.now();

  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.row;

  // 同時に開かれたときは1本にまとめる
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const row = await load();
      store.set(key, { expiresAt: Date.now() + cacheTtlMs(), row });
      return row;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}
