/**
 * ID トークン検証キャッシュの有効期限計算。
 * 単体テストできるよう純粋関数として切り出している。
 */

/**
 * キャッシュの失効時刻（epoch ms）を返す。`null` ならキャッシュしない。
 *
 * - トークン自身の `exp` を超えてキャッシュを生かさない（失効トークンが通るのを防ぐ）
 * - `exp` が取れない／数値でない場合は **キャッシュしない**（毎回 LINE へ検証しに行く）
 *
 * @param nowMs      現在時刻（epoch ms）
 * @param ttlMs      設定上の TTL（ミリ秒）
 * @param expSeconds LINE verify が返す exp（UNIX 秒）
 */
export function resolveVerifyCacheExpiry(
  nowMs: number,
  ttlMs: number,
  expSeconds: unknown,
): number | null {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return null;
  if (typeof expSeconds !== "number" || !Number.isFinite(expSeconds)) {
    return null;
  }

  const expMs = Math.floor(expSeconds) * 1000;
  // すでに失効しているトークンはキャッシュしない
  if (expMs <= nowMs) return null;

  return Math.min(nowMs + ttlMs, expMs);
}
