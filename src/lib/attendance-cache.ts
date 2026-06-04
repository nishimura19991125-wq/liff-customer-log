import "server-only";

import type { AtPocketRecordRow } from "@/lib/atpocket";
import type {
  AttendanceDepartmentGroup,
  AttendancePublicStatus,
  AttendanceTodayAttendee,
} from "@/lib/attendance-fields";

export type AttendanceRosterBundle = {
  rows: AtPocketRecordRow[];
  attendees: AttendanceTodayAttendee[];
  byDepartment: AttendanceDepartmentGroup[];
};

type StatusCacheEntry = {
  expiresAt: number;
  status: AttendancePublicStatus;
};

const statusStore = new Map<string, StatusCacheEntry>();
const statusInflight = new Map<string, Promise<AttendancePublicStatus>>();

type RosterCacheEntry = {
  expiresAt: number;
  bundle: AttendanceRosterBundle;
};

const rosterStore = new Map<string, RosterCacheEntry>();
const rosterInflight = new Map<string, Promise<AttendanceRosterBundle>>();

let rateLimitBlockedUntil = 0;

/** @pocket 429 後はこの間、一覧取得を試みない（既定 100 秒） */
const ATTENDANCE_429_BACKOFF_MS = 100_000;

export function attendanceStatusCacheTtlMs(): number {
  const raw = process.env.ATTENDANCE_STATUS_CACHE_TTL_MS?.trim();
  const n = raw ? Number(raw) : 60_000;
  if (!Number.isFinite(n) || n < 0) return 60_000;
  return Math.min(300_000, Math.floor(n));
}

export function statusCacheKey(staffName: string, workDate: string): string {
  return `${staffName.normalize("NFKC").trim()}\0${workDate}`;
}

export function attendanceRosterCacheKey(workDate: string): string {
  return `roster\0${workDate}`;
}

export function getCachedRosterBundle(
  workDate: string,
): AttendanceRosterBundle | null {
  const hit = rosterStore.get(attendanceRosterCacheKey(workDate));
  if (!hit || hit.expiresAt <= Date.now()) return null;
  return {
    rows: hit.bundle.rows,
    attendees: hit.bundle.attendees.map((a) => ({ ...a })),
    byDepartment: hit.bundle.byDepartment.map((g) => ({
      department: g.department,
      attendees: g.attendees.map((a) => ({ ...a })),
    })),
  };
}

export function getCachedTodayAttendees(
  workDate: string,
): AttendanceTodayAttendee[] | null {
  return getCachedRosterBundle(workDate)?.attendees ?? null;
}

export function setCachedRosterBundle(
  workDate: string,
  bundle: AttendanceRosterBundle,
): void {
  const ttl = attendanceStatusCacheTtlMs();
  if (ttl <= 0) return;
  rosterStore.set(attendanceRosterCacheKey(workDate), {
    expiresAt: Date.now() + ttl,
    bundle: {
      rows: bundle.rows,
      attendees: bundle.attendees.map((a) => ({ ...a })),
      byDepartment: bundle.byDepartment.map((g) => ({
        department: g.department,
        attendees: g.attendees.map((a) => ({ ...a })),
      })),
    },
  });
}

export function invalidateAttendanceRosterCache(workDate?: string): void {
  if (!workDate) {
    rosterStore.clear();
    rosterInflight.clear();
    return;
  }
  const key = attendanceRosterCacheKey(workDate);
  rosterStore.delete(key);
  rosterInflight.delete(key);
}

export async function getTodayRosterBundleCached(
  workDate: string,
  loader: () => Promise<AttendanceRosterBundle>,
  bypassCache?: boolean,
): Promise<AttendanceRosterBundle> {
  const ttl = attendanceStatusCacheTtlMs();
  if (ttl <= 0 || bypassCache) return loader();

  const key = attendanceRosterCacheKey(workDate);
  const now = Date.now();
  const hit = rosterStore.get(key);
  if (hit && hit.expiresAt > now) {
    return {
      rows: hit.bundle.rows,
      attendees: hit.bundle.attendees.map((a) => ({ ...a })),
      byDepartment: hit.bundle.byDepartment.map((g) => ({
        department: g.department,
        attendees: g.attendees.map((a) => ({ ...a })),
      })),
    };
  }

  const pending = rosterInflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const bundle = await loader();
      rosterStore.set(key, {
        expiresAt: Date.now() + ttl,
        bundle: {
          rows: bundle.rows,
          attendees: bundle.attendees.map((a) => ({ ...a })),
          byDepartment: bundle.byDepartment.map((g) => ({
            department: g.department,
            attendees: g.attendees.map((a) => ({ ...a })),
          })),
        },
      });
      return bundle;
    } finally {
      rosterInflight.delete(key);
    }
  })();

  rosterInflight.set(key, promise);
  return promise;
}

export function isAttendanceFetchBlocked(): boolean {
  return Date.now() < rateLimitBlockedUntil;
}

export function blockAttendanceFetchAfterRateLimit(): void {
  rateLimitBlockedUntil = Date.now() + ATTENDANCE_429_BACKOFF_MS;
}

export function getCachedAttendanceStatus(
  staffName: string,
  workDate: string,
): AttendancePublicStatus | null {
  const hit = statusStore.get(statusCacheKey(staffName, workDate));
  if (!hit || hit.expiresAt <= Date.now()) return null;
  return { ...hit.status };
}

/** 429 時に古いキャッシュを返す用 */
export function getStaleAttendanceStatus(
  staffName: string,
  workDate: string,
): AttendancePublicStatus | null {
  const hit = statusStore.get(statusCacheKey(staffName, workDate));
  if (!hit) return null;
  return { ...hit.status, stale: true, rateLimited: true };
}

export function setCachedAttendanceStatus(
  staffName: string,
  workDate: string,
  status: AttendancePublicStatus,
): void {
  const ttl = attendanceStatusCacheTtlMs();
  if (ttl <= 0) return;
  statusStore.set(statusCacheKey(staffName, workDate), {
    expiresAt: Date.now() + ttl,
    status: { ...status },
  });
}

export function invalidateAttendanceStatusCache(
  staffName?: string,
  workDate?: string,
): void {
  if (!staffName || !workDate) {
    statusStore.clear();
    statusInflight.clear();
    invalidateAttendanceRosterCache();
    return;
  }
  const key = statusCacheKey(staffName, workDate);
  statusStore.delete(key);
  statusInflight.delete(key);
  invalidateAttendanceRosterCache(workDate);
}

export async function getAttendanceStatusCached(
  key: string,
  loader: () => Promise<AttendancePublicStatus>,
): Promise<AttendancePublicStatus> {
  const ttl = attendanceStatusCacheTtlMs();
  if (ttl <= 0) return loader();

  const now = Date.now();
  const hit = statusStore.get(key);
  if (hit && hit.expiresAt > now) {
    return { ...hit.status };
  }

  const pending = statusInflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const status = await loader();
      statusStore.set(key, { expiresAt: Date.now() + ttl, status: { ...status } });
      return status;
    } finally {
      statusInflight.delete(key);
    }
  })();

  statusInflight.set(key, promise);
  return promise;
}
