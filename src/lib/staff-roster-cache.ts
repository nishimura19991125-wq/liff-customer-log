import "server-only";

import type { AtPocketRecordRow } from "@/lib/atpocket";
import {
  apiKeyForStaffPocketRead,
  fetchAllRecordsPages,
  fetchRecordsList,
} from "@/lib/atpocket";
import { staffImportKeyFieldIdResolved } from "@/lib/staff-import-key";
import { staffRecordMatchesLineUser } from "@/lib/staff-line-binding";
import {
  staffLineBindingEnabled,
  staffLineUserIdFieldIdsFromEnv,
  staffLineUserIdFieldsCsv,
} from "@/lib/staff-line-field-config";

type RosterCacheEntry = {
  key: string;
  expiresAt: number;
  rows: AtPocketRecordRow[];
};

let rosterCache: RosterCacheEntry | null = null;
let rosterInflight: Promise<AtPocketRecordRow[]> | null = null;
/** @pocket 429 後はこの時刻まで新規取得を試みない */
let rosterFetchBlockedUntil = 0;
let lastRosterStaleWarnAt = 0;

/** @pocket の 100 秒ウィンドウに合わせる */
const ROSTER_429_BACKOFF_MS = 100_000;
const ROSTER_STALE_WARN_COOLDOWN_MS = 300_000;

function rosterCacheTtlMs(): number {
  const raw = process.env.STAFF_ROSTER_CACHE_TTL_MS?.trim();
  const n = raw ? Number(raw) : 600_000;
  if (!Number.isFinite(n) || n < 5_000) return 600_000;
  return Math.min(600_000, Math.floor(n));
}

function rosterCacheKey(): string | null {
  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const staffNameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim();
  if (!staffAppId || !staffNameFieldId) return null;
  const lineIds = staffLineUserIdFieldIdsFromEnv();
  const lineOn = staffLineBindingEnabled(lineIds);
  return `${staffAppId}\0${staffNameFieldId}\0${lineOn ? "line" : "name"}`;
}

function isRateLimited(now: number): boolean {
  return now < rosterFetchBlockedUntil;
}

function blockRosterFetchAfterRateLimit(now: number): void {
  rosterFetchBlockedUntil = now + ROSTER_429_BACKOFF_MS;
  if (rosterCache) {
    rosterCache.expiresAt = Math.max(
      rosterCache.expiresAt,
      now + ROSTER_429_BACKOFF_MS,
    );
  }
}

function isPocketRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes("429") || msg.includes("Too Many Request");
}

function warnStaleRosterOnce(error: unknown): void {
  const now = Date.now();
  if (now - lastRosterStaleWarnAt < ROSTER_STALE_WARN_COOLDOWN_MS) return;
  lastRosterStaleWarnAt = now;
  console.warn(
    "[staff-roster-cache] serving cached roster during @pocket rate limit",
    error,
  );
}

function staffRosterListFieldsCsv(): string {
  const parts: string[] = [];
  const name = process.env.STAFF_NAME_FIELD_ID?.trim();
  if (name) parts.push(name);

  const lineIds = staffLineUserIdFieldIdsFromEnv();
  const lineCsv = staffLineUserIdFieldsCsv(lineIds);
  if (lineCsv) parts.push(...lineCsv.split(","));

  const importKey = staffImportKeyFieldIdResolved();
  if (importKey) parts.push(importKey);

  for (const envKey of [
    "STAFF_AP_AVAILABILITY_FIELD_ID",
    "STAFF_CL_AVAILABILITY_FIELD_ID",
    "STAFF_WORKPLACE_FIELD_ID",
    "STAFF_PIN_HASH_FIELD_ID",
  ] as const) {
    const id = process.env[envKey]?.trim();
    if (id) parts.push(id);
  }

  return [...new Set(parts.map((p) => p.trim()).filter(Boolean))].join(",");
}

async function fetchStaffRosterRowsFromPocket(
  staffAppId: string,
  lineOn: boolean,
): Promise<AtPocketRecordRow[]> {
  const auth = { apiKey: apiKeyForStaffPocketRead() };
  const ctx = { operation: "staff:名簿一覧", appEnv: "STAFF_APP_ID" };
  const staffNameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim() ?? "";

  if (lineOn) {
    const fieldsCsv = staffRosterListFieldsCsv();
    return fetchAllRecordsPages(
      staffAppId,
      fieldsCsv,
      auth,
      null,
      ctx,
    );
  }

  return (
    await fetchRecordsList(
      staffAppId,
      {
        limit: "1000",
        page: "1",
        fields: staffNameFieldId,
      },
      auth,
      ctx,
    )
  ).records ?? [];
}

/** スタッフ名簿一覧（メモリキャッシュ・429 時は古い名簿を返して API 連打を抑止） */
export async function fetchStaffRosterRowsCached(): Promise<
  AtPocketRecordRow[]
> {
  const key = rosterCacheKey();
  const staffAppId = process.env.STAFF_APP_ID?.trim();
  if (!key || !staffAppId) return [];

  const now = Date.now();
  if (
    rosterCache &&
    rosterCache.key === key &&
    rosterCache.expiresAt > now
  ) {
    return rosterCache.rows;
  }

  const staleRows =
    rosterCache && rosterCache.key === key ? rosterCache.rows : null;

  if (staleRows && staleRows.length > 0 && isRateLimited(now)) {
    return staleRows;
  }

  if (rosterInflight) return rosterInflight;

  rosterInflight = (async () => {
    try {
      const lineIds = staffLineUserIdFieldIdsFromEnv();
      const lineOn = staffLineBindingEnabled(lineIds);
      const rows = await fetchStaffRosterRowsFromPocket(staffAppId, lineOn);

      rosterCache = {
        key,
        expiresAt: Date.now() + rosterCacheTtlMs(),
        rows,
      };
      rosterFetchBlockedUntil = 0;
      return rows;
    } catch (error) {
      if (isPocketRateLimitError(error)) {
        blockRosterFetchAfterRateLimit(Date.now());
      }
      if (staleRows && staleRows.length > 0) {
        if (isPocketRateLimitError(error)) {
          warnStaleRosterOnce(error);
        } else {
          console.warn(
            "[staff-roster-cache] fallback to stale roster after fetch error",
            error,
          );
        }
        return staleRows;
      }
      throw error;
    } finally {
      rosterInflight = null;
    }
  })();

  return rosterInflight;
}

/**
 * 名簿キャッシュを論理無効化（行データは保持し 429 時のフォールバックに使う）。
 * hard=true のときのみ完全削除。
 */
export function invalidateStaffRosterCache(hard = false): void {
  rosterInflight = null;
  if (hard) {
    rosterCache = null;
    return;
  }
  if (rosterCache) {
    rosterCache.expiresAt = Date.now();
  }
}

/** LINE 紐付け直後にキャッシュ上のレコードを更新し、即時の全件再取得を避ける */
export function patchStaffRosterAfterLineBind(opts: {
  recordId: string;
  lineFieldId: string;
  lineUserId: string;
  recordSnapshot?: Record<string, unknown>;
}): void {
  if (!rosterCache?.rows.length) return;

  for (const row of rosterCache.rows) {
    const id =
      row.recordId != null ? String(row.recordId) : String(row.uniqueId ?? "");
    if (id !== opts.recordId) continue;

    const base =
      row.record && typeof row.record === "object"
        ? { ...(row.record as Record<string, unknown>) }
        : {};
    if (opts.recordSnapshot) {
      Object.assign(base, opts.recordSnapshot);
    }
    base[opts.lineFieldId] = opts.lineUserId;
    row.record = base;
    rosterCache.expiresAt = Date.now() + rosterCacheTtlMs();
    return;
  }
}

export function boundStaffFromRosterRows(
  rows: AtPocketRecordRow[],
  lineUserId: string,
): { id: string; name: string } | null {
  const staffNameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim();
  if (!staffNameFieldId) return null;

  const lineIds = staffLineUserIdFieldIdsFromEnv();
  if (!staffLineBindingEnabled(lineIds)) return null;

  for (const row of rows) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const id =
      row.recordId != null ? String(row.recordId) : row.uniqueId ?? "";
    const rawName = (rec as Record<string, unknown>)[staffNameFieldId];
    const name =
      rawName === undefined || rawName === null ? "" : String(rawName).trim();
    if (!id || !name) continue;
    if (
      staffRecordMatchesLineUser(
        rec as Record<string, unknown>,
        lineIds.lineField1,
        lineIds.lineField2,
        lineUserId,
      )
    ) {
      return { id, name };
    }
  }
  return null;
}
