import "server-only";

import type { AtPocketRecordRow } from "@/lib/atpocket";
import {
  fetchRecordsList,
  isPocketApiRateLimited,
  staffReadListAuths,
} from "@/lib/atpocket";
import { staffImportKeyFieldIdResolved } from "@/lib/staff-import-key";
import { staffRecordMatchesLineUser } from "@/lib/staff-line-binding";
import { resolveStaffGeneralAvailabilityConfig } from "@/lib/staff-general-availability";
import {
  staffLineBindingEnabled,
  staffLineUserIdFieldIdsFromEnv,
  staffLineUserIdFieldsCsv,
} from "@/lib/staff-line-field-config";
import { staffPhoneFieldIdConfigured } from "@/lib/staff-phone-field-config";

type RosterCacheEntry = {
  key: string;
  freshUntil: number;
  rows: AtPocketRecordRow[];
};

let rosterCache: RosterCacheEntry | null = null;
let rosterInflight: Promise<AtPocketRecordRow[]> | null = null;
/** @pocket 429 後はこの時刻まで新規取得を試みない */
let rosterFetchBlockedUntil = 0;
let lastRosterStaleWarnAt = 0;
/** 連続した @pocket 取得の間隔を空ける（TTL 切れ直後の連打防止） */
let lastFetchAttemptAt = 0;

/** @pocket の 100 秒ウィンドウに合わせる */
const ROSTER_429_BACKOFF_MS = 100_000;
const ROSTER_STALE_WARN_COOLDOWN_MS = 300_000;
/** fresh TTL 切れ後も古い名簿を返してよい最長時間 */
const ROSTER_STALE_SERVE_MS = 6 * 60 * 60 * 1000;

/** スタッフ名簿キャッシュ TTL（既定 30 分・最大 1 時間） */
export function staffRosterCacheTtlMs(): number {
  const raw = process.env.STAFF_ROSTER_CACHE_TTL_MS?.trim();
  const n = raw ? Number(raw) : 1_800_000;
  if (!Number.isFinite(n) || n < 5_000) return 1_800_000;
  return Math.min(3_600_000, Math.floor(n));
}

/** 1000 件超の名簿のみ追加ページ取得（既定 1 ページ＝最大 1 回の追加 API） */
function staffRosterExtraPagesAfterFull(): number {
  const raw = process.env.STAFF_ROSTER_MAX_PAGES?.trim();
  const n = raw ? Number(raw) : 1;
  if (!Number.isFinite(n) || n < 0) return 1;
  return Math.min(20, Math.floor(n));
}

function staffRosterMinRefetchMs(): number {
  const raw = process.env.STAFF_ROSTER_MIN_REFETCH_MS?.trim();
  const n = raw ? Number(raw) : 300_000;
  if (!Number.isFinite(n) || n < 0) return 300_000;
  return Math.min(600_000, Math.floor(n));
}

/** 429 時の再試行は上限をさらに消費するため行わない */
const STAFF_LIST_FETCH_OPTIONS = { maxRetries: 0 } as const;

/** 名簿 fields CSV の版（列追加時にキャッシュを無効化） */
const STAFF_ROSTER_FIELDS_CSV_VERSION = "3";

function appendFieldIdsToCsv(
  fields: string,
  ids: Array<string | null | undefined>,
): string {
  const parts = new Set(
    fields
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean),
  );
  for (const id of ids) {
    const t = id?.trim();
    if (t) parts.add(t);
  }
  return [...parts].join(",");
}

async function mergeContactsPhoneFieldIntoCsv(fields: string): Promise<string> {
  try {
    const { resolveStaffContactsDirectoryConfig } = await import(
      "@/lib/staff-contacts-directory"
    );
    const cfg = await resolveStaffContactsDirectoryConfig();
    if (!cfg?.phoneFieldId) return fields;
    return appendFieldIdsToCsv(fields, [cfg.phoneFieldId]);
  } catch {
    return fields;
  }
}

function rosterCacheKey(): string | null {
  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const staffNameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim();
  if (!staffAppId || !staffNameFieldId) return null;
  const lineIds = staffLineUserIdFieldIdsFromEnv();
  const lineOn = staffLineBindingEnabled(lineIds);
  const phoneEnv = staffPhoneFieldIdConfigured();
  return `${staffAppId}\u0000${staffNameFieldId}\u0000${lineOn ? "line" : "name"}\u0000${phoneEnv}\u0000${STAFF_ROSTER_FIELDS_CSV_VERSION}`;
}

function isRateLimited(now: number): boolean {
  return now < rosterFetchBlockedUntil;
}

function blockRosterFetchAfterRateLimit(now: number): void {
  rosterFetchBlockedUntil = now + ROSTER_429_BACKOFF_MS;
  if (rosterCache) {
    rosterCache.freshUntil = Math.max(
      rosterCache.freshUntil,
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

function staleServeAllowed(now: number, entry: RosterCacheEntry): boolean {
  if (!entry.rows.length) return false;
  return now < entry.freshUntil + ROSTER_STALE_SERVE_MS;
}

/** エラー時のフォールバック用（メモリ上の名簿があれば返す） */
export function getStaffRosterRowsBestEffort(): AtPocketRecordRow[] {
  const key = rosterCacheKey();
  if (!key || !rosterCache || rosterCache.key !== key) return [];
  return rosterCache.rows;
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
    "STAFF_AVAILABILITY_FIELD_ID",
    "STAFF_AP_AVAILABILITY_FIELD_ID",
    "STAFF_CL_AVAILABILITY_FIELD_ID",
    "STAFF_WORKPLACE_FIELD_ID",
    "STAFF_DEPARTMENT_FIELD_ID",
    "STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID",
    "STAFF_PIN_HASH_FIELD_ID",
  ] as const) {
    const id = process.env[envKey]?.trim();
    if (id) parts.push(id);
  }

  parts.push(staffPhoneFieldIdConfigured());

  return [...new Set(parts.map((p) => p.trim()).filter(Boolean))].join(",");
}

/** 名簿一覧で AP/CL・勤務場所・LINE 等を fields に含めるか */
function staffRosterUseExtendedFieldsCsv(): boolean {
  const lineIds = staffLineUserIdFieldIdsFromEnv();
  if (lineIds.lineField1 || lineIds.lineField2) return true;
  for (const envKey of [
    "STAFF_AP_AVAILABILITY_FIELD_ID",
    "STAFF_CL_AVAILABILITY_FIELD_ID",
    "STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID",
    "STAFF_WORKPLACE_FIELD_ID",
    "STAFF_DEPARTMENT_FIELD_ID",
    "STAFF_PHONE_FIELD_ID",
    "STAFF_AVAILABILITY_FIELD_ID",
  ] as const) {
    if (process.env[envKey]?.trim()) return true;
  }
  return false;
}

async function fetchStaffRosterRowsFromPocket(
  staffAppId: string,
): Promise<AtPocketRecordRow[]> {
  const listAuths = staffReadListAuths();
  const ctx = { operation: "staff:名簿一覧", appEnv: "STAFF_APP_ID" };
  const staffNameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim() ?? "";
  const extended = staffRosterUseExtendedFieldsCsv();
  let fields = extended ? staffRosterListFieldsCsv() : staffNameFieldId;
  if (extended) {
    const avail = await resolveStaffGeneralAvailabilityConfig();
    if (avail.ok) {
      fields = appendFieldIdsToCsv(fields, [avail.cfg.fieldId]);
    }
  }
  fields = await mergeContactsPhoneFieldIntoCsv(fields);

  const listOptions = {
    ...STAFF_LIST_FETCH_OPTIONS,
    authKeys: listAuths.length >= 2 ? listAuths : undefined,
  };

  const first = await fetchRecordsList(
    staffAppId,
    { limit: "1000", page: "1", fields },
    listAuths[0],
    ctx,
    { ...listOptions, authStartIndex: 0 },
  );
  const rows: AtPocketRecordRow[] = [...(first.records ?? [])];
  if (rows.length < 1000) return rows;

  const extraPages = staffRosterExtraPagesAfterFull();
  for (let page = 2; page <= 1 + extraPages; page++) {
    const pageStart =
      listAuths.length > 0 ? (page - 1) % listAuths.length : 0;
    const data = await fetchRecordsList(
      staffAppId,
      { limit: "1000", page: String(page), fields },
      listAuths[pageStart] ?? listAuths[0],
      ctx,
      { ...listOptions, authStartIndex: pageStart },
    );
    const recs = data.records ?? [];
    rows.push(...recs);
    if (recs.length < 1000) break;
  }
  return rows;
}

/** スタッフ名簿一覧（メモリキャッシュ・429 時は古い名簿を返して API 連打を抑止） */
export async function fetchStaffRosterRowsCached(): Promise<
  AtPocketRecordRow[]
> {
  const key = rosterCacheKey();
  const staffAppId = process.env.STAFF_APP_ID?.trim();
  if (!key || !staffAppId) return [];

  const now = Date.now();

  if (rosterCache && rosterCache.key === key && now < rosterCache.freshUntil) {
    return rosterCache.rows;
  }

  const staleRows =
    rosterCache && rosterCache.key === key ? rosterCache.rows : null;
  const staleEntry =
    rosterCache && rosterCache.key === key ? rosterCache : null;

  const staffAuths = staffReadListAuths();
  const staffAuth = staffAuths[0];
  const globallyLimited =
    staffAuth?.apiKey != null && isPocketApiRateLimited(staffAuth);

  if (staleRows && staleRows.length > 0) {
    if (isRateLimited(now) || globallyLimited) {
      warnStaleRosterOnce(new Error("rate limit backoff active"));
      return staleRows;
    }
    if (
      staleEntry &&
      staleServeAllowed(now, staleEntry) &&
      now - lastFetchAttemptAt < staffRosterMinRefetchMs()
    ) {
      return staleRows;
    }
  }

  if ((isRateLimited(now) || globallyLimited) && !staleRows?.length) {
    console.warn(
      "[staff-roster-cache] skip @pocket fetch during rate limit (no cached roster)",
    );
    return [];
  }

  if (rosterInflight) return rosterInflight;

  rosterInflight = (async () => {
    lastFetchAttemptAt = Date.now();
    try {
      const rows = await fetchStaffRosterRowsFromPocket(staffAppId);

      rosterCache = {
        key,
        freshUntil: Date.now() + staffRosterCacheTtlMs(),
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
    rosterCache.freshUntil = Date.now();
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
    rosterCache.freshUntil = Date.now() + staffRosterCacheTtlMs();
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
