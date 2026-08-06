import "server-only";

/**
 * 呼び出し元単位の簡易レート制限（スライディングウィンドウ）。
 *
 * ⚠ 保存先はプロセスメモリ。Netlify Functions が複数インスタンスで動く場合、
 *    実効的な上限は「上限 × インスタンス数」になる。
 *    厳密な制限が必要になったら共有ストア（Redis 等）へ移すこと。
 */

type Bucket = number[];

const buckets = new Map<string, Bucket>();

/** エントリ上限。超えたら古いものから捨てる（メモリ肥大の防止） */
const MAX_KEYS = 5000;

export type RateLimitOptions = {
  /** ウィンドウ長（ミリ秒） */
  windowMs: number;
  /** ウィンドウ内に許す回数 */
  max: number;
};

/**
 * 1回分を消費し、上限内なら true を返す。
 * 上限を超えていれば false（呼び出し側で 429 を返す）。
 */
export function consumeRateLimit(
  key: string,
  options: RateLimitOptions,
  now = Date.now(),
): boolean {
  const { windowMs, max } = options;
  if (!Number.isFinite(windowMs) || windowMs <= 0 || max <= 0) return true;

  const since = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > since);

  if (hits.length >= max) {
    buckets.set(key, hits);
    return false;
  }

  hits.push(now);
  buckets.set(key, hits);

  while (buckets.size > MAX_KEYS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
  return true;
}

/** テスト用 */
export function resetRateLimitStore(): void {
  buckets.clear();
}
