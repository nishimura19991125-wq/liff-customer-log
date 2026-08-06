import "server-only";

import { createHash } from "node:crypto";

/**
 * PIN 総当たり対策の試行カウンタ。
 *
 * ⚠ 保存先はプロセスメモリ。Netlify Functions が複数インスタンスで動く場合、
 *    実効的な試行上限は「しきい値 × インスタンス数」になる。
 *    恒久対策には共有ストア（Redis 等）か @pocket 側での試行回数管理が必要。
 */

type AttemptEntry = {
  failures: number;
  /** ロック解除時刻（epoch ms）。0 ならロックされていない */
  lockedUntil: number;
  lastFailureAt: number;
};

const attempts = new Map<string, AttemptEntry>();

/** エントリの上限。超えたら古いものから捨てる（メモリ肥大の防止） */
const MAX_ENTRIES = 5000;

export function pinMaxAttempts(): number {
  const raw = process.env.STAFF_PIN_MAX_ATTEMPTS?.trim();
  const n = raw ? Number(raw) : 5;
  if (!Number.isFinite(n) || n < 1) return 5;
  return Math.min(100, Math.floor(n));
}

export function pinLockoutMs(): number {
  const raw = process.env.STAFF_PIN_LOCKOUT_SECONDS?.trim();
  const n = raw ? Number(raw) : 900;
  if (!Number.isFinite(n) || n < 1) return 900_000;
  return Math.min(86_400, Math.floor(n)) * 1000;
}

/**
 * ログ用の識別子。生の LINE userId は出力しない。
 * 個人を横断で追跡できてしまうため、ハッシュの先頭 8 桁だけを使う。
 */
export function pinActorTag(lineUserId: string): string {
  return createHash("sha256").update(lineUserId).digest("hex").slice(0, 8);
}

function pruneAndGet(key: string, now: number): AttemptEntry | undefined {
  const entry = attempts.get(key);
  if (!entry) return undefined;
  // ロックが切れ、かつ最終失敗から十分経っていれば忘れる
  if (entry.lockedUntil !== 0 && entry.lockedUntil <= now) {
    attempts.delete(key);
    return undefined;
  }
  return entry;
}

function enforceSizeLimit(): void {
  while (attempts.size > MAX_ENTRIES) {
    const oldest = attempts.keys().next().value;
    if (oldest === undefined) break;
    attempts.delete(oldest);
  }
}

/** ロック中かどうか。残り時間は返さない（総当たりの補助情報になるため） */
export function isPinLocked(lineUserId: string, now = Date.now()): boolean {
  const entry = pruneAndGet(lineUserId, now);
  return Boolean(entry && entry.lockedUntil > now);
}

/**
 * 失敗を1件記録する。しきい値に達したらロックする。
 * 戻り値はサーバログ用で、クライアントへ返してはならない。
 */
export function recordPinFailure(
  lineUserId: string,
  now = Date.now(),
): { failures: number; locked: boolean } {
  const entry = pruneAndGet(lineUserId, now) ?? {
    failures: 0,
    lockedUntil: 0,
    lastFailureAt: 0,
  };

  entry.failures += 1;
  entry.lastFailureAt = now;

  const locked = entry.failures >= pinMaxAttempts();
  if (locked) entry.lockedUntil = now + pinLockoutMs();

  attempts.set(lineUserId, entry);
  enforceSizeLimit();

  return { failures: entry.failures, locked };
}

/** 認証成功時に呼ぶ */
export function clearPinFailures(lineUserId: string): void {
  attempts.delete(lineUserId);
}

/** テスト用 */
export function resetPinAttemptStore(): void {
  attempts.clear();
}
