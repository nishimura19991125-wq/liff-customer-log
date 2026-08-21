import "server-only";

/**
 * 日本の祝日を外部APIから取得する（タスクV-4）。
 *
 * ■ 選定: holidays-jp（https://holidays-jp.github.io/api/v1/{year}/date.json）
 *  - 無料・APIキー不要・利用登録不要
 *  - GitHub Pages 配信の**静的JSON**なので、レート制限が無く落ちにくい
 *  - 内閣府の公開データが元。年ごとのエンドポイントがあり、先の年も引ける
 *  - 応答は { "2026-01-01": "元日", ... } の素直な形
 *
 * ■ 外部依存で業務を止めない
 * 取得に失敗したら**土日のみ**で判定するフォールバックに落ちる。
 * 祝日を取り逃すと営業日を多めに数える＝空き枠を作りやすくなる方向で、
 * 「作らないはずの枠を作る」より「作るはずの枠を作らない」ほうが害が
 * 小さいわけではないため、degraded を呼び出し側へ返して記録できるようにする。
 */

const DEFAULT_BASE_URL = "https://holidays-jp.github.io/api/v1";
const DEFAULT_TIMEOUT_MS = 3_000;
/** 祝日は頻繁に変わらない。既定24時間 */
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** 取得に失敗したとき、古い内容をどこまで使い続けるか */
const STALE_SERVE_MS = 30 * 24 * 60 * 60 * 1000;

function baseUrl(): string {
  return process.env.JAPAN_HOLIDAY_API_BASE_URL?.trim() || DEFAULT_BASE_URL;
}

function timeoutMs(): number {
  const raw = process.env.JAPAN_HOLIDAY_API_TIMEOUT_MS?.trim();
  const n = raw ? Number(raw) : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(15_000, Math.floor(n));
}

function cacheTtlMs(): number {
  const raw = process.env.JAPAN_HOLIDAY_API_CACHE_MS?.trim();
  const n = raw ? Number(raw) : DEFAULT_CACHE_TTL_MS;
  if (!Number.isFinite(n) || n < 0) return DEFAULT_CACHE_TTL_MS;
  return Math.floor(n);
}

type YearCacheEntry = {
  freshUntil: number;
  staleUntil: number;
  keys: string[];
};

const yearCache = new Map<number, YearCacheEntry>();
const inflight = new Map<number, Promise<string[] | null>>();

/** テストと運用（手動リセット）用 */
export function clearJapanHolidayApiCache(): void {
  yearCache.clear();
  inflight.clear();
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseHolidayPayload(raw: unknown, year: number): string[] {
  if (!raw || typeof raw !== "object") return [];
  const out: string[] = [];
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    const k = key.trim();
    if (!DAY_KEY_RE.test(k)) continue;
    if (Number(k.slice(0, 4)) !== year) continue;
    out.push(k);
  }
  return out;
}

async function fetchYearFromApi(year: number): Promise<string[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const res = await fetch(`${baseUrl()}/${year}/date.json`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(
        "[japan-holidays-api] 祝日の取得に失敗",
        JSON.stringify({ year, status: res.status }),
      );
      return null;
    }
    const json = (await res.json()) as unknown;
    return parseHolidayPayload(json, year);
  } catch (e) {
    const aborted =
      typeof e === "object" &&
      e !== null &&
      (e as { name?: unknown }).name === "AbortError";
    console.warn(
      "[japan-holidays-api] 祝日の取得に失敗",
      JSON.stringify({ year, reason: aborted ? "timeout" : "network" }),
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function holidayKeysForYear(year: number): Promise<string[] | null> {
  const now = Date.now();
  const hit = yearCache.get(year);
  if (hit && now < hit.freshUntil) return hit.keys;

  const pending = inflight.get(year);
  if (pending) return pending;

  const promise = (async () => {
    const keys = await fetchYearFromApi(year);
    if (keys) {
      const ttl = cacheTtlMs();
      yearCache.set(year, {
        freshUntil: Date.now() + ttl,
        staleUntil: Date.now() + ttl + STALE_SERVE_MS,
        keys,
      });
      return keys;
    }
    // 取得できなくても、期限内の古い内容があればそれを使う
    if (hit && Date.now() < hit.staleUntil) return hit.keys;
    return null;
  })().finally(() => {
    inflight.delete(year);
  });

  inflight.set(year, promise);
  return promise;
}

export type JapanHolidayLookup = {
  keys: Set<string>;
  /**
   * true のとき、いずれかの年で祝日を取得できず**土日のみ**で判定している。
   * 呼び出し側はログや警告に使う。
   */
  degraded: boolean;
};

/**
 * 指定した年（範囲）の祝日キーを返す。
 * 取得できなかった年は空のまま扱い、degraded を立てる（＝土日のみ判定）。
 */
export async function fetchJapanHolidayKeysForYears(
  years: readonly number[],
): Promise<JapanHolidayLookup> {
  const unique = [...new Set(years)].filter((y) =>
    Number.isFinite(y) && y >= 1900 && y <= 2200,
  );
  const keys = new Set<string>();
  let degraded = false;

  const results = await Promise.all(
    unique.map(async (y) => ({ year: y, keys: await holidayKeysForYear(y) })),
  );
  for (const r of results) {
    if (!r.keys) {
      degraded = true;
      continue;
    }
    for (const k of r.keys) keys.add(k);
  }

  // 環境変数で足す祝日は API が落ちていても効かせる
  const extra = process.env.CALENDAR_EXTRA_HOLIDAYS?.trim();
  if (extra) {
    for (const k of extra.split(",").map((s) => s.trim())) {
      if (DAY_KEY_RE.test(k)) keys.add(k);
    }
  }

  return { keys, degraded };
}

/** 2つの日付キーがまたぐ年の祝日を引く */
export async function fetchJapanHolidayKeysForRange(
  fromDayKey: string,
  toDayKey: string,
): Promise<JapanHolidayLookup> {
  const fromYear = Number(fromDayKey.slice(0, 4));
  const toYear = Number(toDayKey.slice(0, 4));
  if (!Number.isFinite(fromYear) || !Number.isFinite(toYear)) {
    return { keys: new Set<string>(), degraded: true };
  }
  const years: number[] = [];
  for (let y = Math.min(fromYear, toYear); y <= Math.max(fromYear, toYear); y++) {
    years.push(y);
  }
  return fetchJapanHolidayKeysForYears(years);
}
