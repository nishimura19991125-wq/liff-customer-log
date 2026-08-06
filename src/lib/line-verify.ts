import "server-only";

import { createHash } from "node:crypto";

import { resolveVerifyCacheExpiry } from "@/lib/line-verify-cache-expiry";

/** LINE の verify が IdToken 期限切れを返したとき */
export class LineIdTokenExpiredError extends Error {
  constructor() {
    super("LINE IdToken expired");
    this.name = "LineIdTokenExpiredError";
  }
}

const VERIFY_CACHE_MAX_ENTRIES = 2000;
const VERIFY_CACHE_TTL_DEFAULT_SECONDS = 45;
const VERIFY_CACHE_TTL_MAX_SECONDS = 300;

type VerifyCacheEntry = {
  sub: string;
  expiresAt: number;
};

const verifyCache = new Map<string, VerifyCacheEntry>();
const verifyInflight = new Map<string, Promise<{ sub: string }>>();

function lineVerifyCacheTtlMs(): number {
  const raw = process.env.LINE_VERIFY_CACHE_SECONDS?.trim();
  const parsed =
    raw === undefined || raw === ""
      ? VERIFY_CACHE_TTL_DEFAULT_SECONDS
      : Number(raw);
  if (!Number.isFinite(parsed)) return VERIFY_CACHE_TTL_DEFAULT_SECONDS * 1000;
  const seconds = Math.min(
    VERIFY_CACHE_TTL_MAX_SECONDS,
    Math.max(0, Math.floor(parsed)),
  );
  return seconds * 1000;
}

/**
 * キャッシュキー。**生の ID トークンをキーに使わない**。
 * そのまま使うと有効な Bearer トークンが最大 2000 本プロセスメモリに平文常駐し、
 * ヒープダンプから全ユーザーになりすませてしまう。
 * この関数は export しない（キーの作り方を外へ広げないため）。
 */
function verifyCacheKey(channelId: string, idToken: string): string {
  return createHash("sha256").update(`${channelId}\n${idToken}`).digest("hex");
}

function pruneExpiredVerifyCache(now: number): void {
  for (const [key, entry] of verifyCache) {
    if (entry.expiresAt <= now) {
      verifyCache.delete(key);
    }
  }
}

function enforceVerifyCacheSizeLimit(): void {
  while (verifyCache.size > VERIFY_CACHE_MAX_ENTRIES) {
    const oldest = verifyCache.keys().next().value;
    if (oldest === undefined) break;
    verifyCache.delete(oldest);
  }
}

function setVerifyCacheEntry(
  key: string,
  sub: string,
  expiresAt: number,
): void {
  pruneExpiredVerifyCache(Date.now());
  verifyCache.set(key, { sub, expiresAt });
  enforceVerifyCacheSizeLimit();
}

function lineVerifyResponseLooksExpired(bodyText: string): boolean {
  try {
    const j = JSON.parse(bodyText) as { error_description?: string };
    return /expired/i.test(String(j.error_description ?? ""));
  } catch {
    return false;
  }
}

/** LINE Login の ID トークンを検証し `sub`（ユーザー ID）を返す */
export async function verifyLineIdToken(
  idToken: string,
  channelId: string,
): Promise<{ sub: string; exp?: number }> {
  const body = new URLSearchParams({
    id_token: idToken,
    client_id: channelId,
  });

  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[line-verify] LINE verify failed:", res.status, text);
    if (lineVerifyResponseLooksExpired(text)) {
      throw new LineIdTokenExpiredError();
    }
    throw new Error(`LINE token verification failed (${res.status})`);
  }

  const json = (await res.json()) as { sub?: string; exp?: unknown };
  if (!json.sub || typeof json.sub !== "string") {
    throw new Error("LINE token response missing sub");
  }

  return {
    sub: json.sub,
    ...(typeof json.exp === "number" && Number.isFinite(json.exp)
      ? { exp: json.exp }
      : {}),
  };
}

/**
 * verifyLineIdToken の短時間キャッシュ付きラッパー。
 * 成功結果のみキャッシュ（期限切れ・検証失敗はキャッシュしない）。
 * キャッシュキーは sha256 で、生の ID トークンはメモリに残さない。
 * 有効期限は min(TTL, トークンの exp) にクランプする。
 * LINE_VERIFY_CACHE_SECONDS=0 のときは毎回ネットワーク検証する。
 */
export async function verifyLineIdTokenCached(
  idToken: string,
  channelId: string,
): Promise<{ sub: string }> {
  const ttlMs = lineVerifyCacheTtlMs();
  if (ttlMs <= 0) {
    const { sub } = await verifyLineIdToken(idToken, channelId);
    return { sub };
  }

  const key = verifyCacheKey(channelId, idToken);
  const now = Date.now();
  const cached = verifyCache.get(key);
  if (cached && cached.expiresAt > now) {
    return { sub: cached.sub };
  }

  const pending = verifyInflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const result = await verifyLineIdToken(idToken, channelId);
      // トークンの exp を超えてキャッシュを生かさない。
      // exp が取れないときはキャッシュせず毎回検証する。
      const expiresAt = resolveVerifyCacheExpiry(Date.now(), ttlMs, result.exp);
      if (expiresAt !== null) {
        setVerifyCacheEntry(key, result.sub, expiresAt);
      }
      return { sub: result.sub };
    } finally {
      verifyInflight.delete(key);
    }
  })();

  verifyInflight.set(key, promise);
  return promise;
}
