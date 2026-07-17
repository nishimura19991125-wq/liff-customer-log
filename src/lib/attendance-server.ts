import "server-only";

import {
  apiKeyForAttendancePocket,
  apiKeyForAttendancePocket1,
  apiKeyForAttendanceWrite,
  createRecord,
  fetchAllRecordsPages,
  fetchAppFields,
  fetchRecordsList,
  isPocketApiRateLimited,
  isPocketHttpRateLimitError,
  markPocketApiRateLimited,
  type AtPocketRecordRow,
  updateRecord,
} from "@/lib/atpocket";
import {
  blockAttendanceFetchAfterRateLimit,
  getAttendanceStatusCached,
  getCachedAttendanceStatus,
  getCachedRosterBundle,
  getStaleAttendanceStatus,
  getTodayRosterBundleCached,
  invalidateAttendanceStatusCache,
  isAttendanceFetchBlocked,
  setCachedAttendanceStatus,
  setCachedRosterBundle,
  statusCacheKey,
} from "@/lib/attendance-cache";
import {
  attendanceFieldsConfigured,
  attendanceFieldsCsv,
  resolveAttendanceFieldIds,
  type AttendanceDepartmentGroup,
  type AttendanceFieldIds,
  type AttendancePublicStatus,
  type AttendanceTodayAttendee,
} from "@/lib/attendance-fields";
import { enrichStaffNamesWithDepartments } from "@/lib/staff-department-lookup";
import { pickRecordValueByFieldAliases, ymdKey } from "@/lib/calendar-kojo";
import { atPocketRecordIdFromRow } from "@/lib/atpocket-record-id";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";
import {
  extractDisplayHHmm,
  type AttendanceDayRecord,
} from "@/lib/attendance-calendar-types";

export type { AttendancePublicStatus } from "@/lib/attendance-fields";

const ATTENDANCE_RATE_LIMIT_MESSAGE =
  "データ取得の利用上限に達しました。1〜2分待ってから再度お試しください。";

/** 列定義は滅多に変わらないためメモリに保持（@pocket fields API の連打を防ぐ） */
const ATTENDANCE_FIELDS_CACHE_MS = 3_600_000;
let attendanceFieldsCache: {
  appId: string;
  ids: AttendanceFieldIds;
  expiresAt: number;
} | null = null;

function attendanceAppId(): string | null {
  return process.env.ATTENDANCE_APP_ID?.trim() || null;
}

function cachedAttendanceFieldIds(appId: string): AttendanceFieldIds | null {
  if (!attendanceFieldsCache || attendanceFieldsCache.appId !== appId) {
    return null;
  }
  return attendanceFieldsCache.ids;
}

function rememberAttendanceFieldIds(
  appId: string,
  ids: AttendanceFieldIds,
): void {
  attendanceFieldsCache = {
    appId,
    ids,
    expiresAt: Date.now() + ATTENDANCE_FIELDS_CACHE_MS,
  };
}

function todayYmdJst(): string {
  const d = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }),
  );
  return ymdKey(d);
}

function nowDateTimeJst(): string {
  const d = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }),
  );
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const sec = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}:${sec}`;
}

function nfkcName(s: string): string {
  return s.normalize("NFKC").trim();
}

function extractPocketCell(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (
    typeof raw === "string" ||
    typeof raw === "number" ||
    typeof raw === "boolean"
  ) {
    return raw;
  }
  if (Array.isArray(raw)) {
    const parts = raw
      .map(extractPocketCell)
      .filter(
        (x) => x !== null && x !== undefined && String(x).trim() !== "",
      );
    return parts.join(", ");
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if ("value" in o) return o.value;
    if ("name" in o) return o.name;
    if ("label" in o) return o.label;
    if ("text" in o) return o.text;
  }
  return raw;
}

function readFieldText(
  recObj: Record<string, unknown>,
  fieldId: string | null,
): string {
  if (!fieldId) return "";
  const raw = pickRecordValueByFieldAliases(recObj, fieldId);
  const v = extractPocketCell(raw);
  if (v === null || v === undefined) return "";
  return nfkcName(String(v));
}

function parseWorkDateYmd(raw: string): string | null {
  const s = raw.replace(/\//g, "-").trim();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (!m) return null;
  const y = m[1];
  const mo = String(Number(m[2])).padStart(2, "0");
  const d = String(Number(m[3])).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

function recordAppliesToToday(
  recObj: Record<string, unknown>,
  ids: AttendanceFieldIds,
  today: string,
): boolean {
  const ymd = parseWorkDateYmd(readFieldText(recObj, ids.workDate));
  if (ymd === today) return true;
  if (ymd && ymd !== today) return false;

  const inYmd = parseWorkDateYmd(readFieldText(recObj, ids.clockIn));
  const outYmd = parseWorkDateYmd(readFieldText(recObj, ids.clockOut));
  return inYmd === today || outYmd === today;
}

function pocketRowHasAttendanceData(
  recObj: Record<string, unknown>,
  ids: AttendanceFieldIds,
): boolean {
  return Boolean(
    readFieldText(recObj, ids.clockIn) || readFieldText(recObj, ids.clockOut),
  );
}

function attendanceRosterMaxPages(): number {
  const raw = process.env.ATTENDANCE_ROSTER_MAX_PAGES?.trim();
  const n = raw ? Number(raw) : 2;
  if (!Number.isFinite(n) || n < 1) return 2;
  return Math.min(5, Math.floor(n));
}

function clockInSortKey(raw: string): number {
  const s = raw.trim().replace(/\//g, "-").replace("T", " ");
  const m = /(\d{1,2}):(\d{2})/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function buildTodayAttendees(
  rows: AtPocketRecordRow[],
  ids: AttendanceFieldIds,
  today: string,
): AttendanceTodayAttendee[] {
  const byName = new Map<string, AttendanceTodayAttendee>();

  for (const row of rows) {
    const recObj = row.record ?? {};
    if (!recordAppliesToToday(recObj, ids, today)) continue;

    const name = readFieldText(recObj, ids.staffName);
    const clockIn = readFieldText(recObj, ids.clockIn);
    if (!name || !clockIn) continue;

    const key = nfkcName(name);
    const clockOut = readFieldText(recObj, ids.clockOut) || null;
    const cur = byName.get(key);
    if (!cur || clockInSortKey(clockIn) < clockInSortKey(cur.clockIn)) {
      byName.set(key, { staffName: name, clockIn, clockOut });
    }
  }

  return Array.from(byName.values()).sort(
    (a, b) => clockInSortKey(a.clockIn) - clockInSortKey(b.clockIn),
  );
}

const DEPARTMENT_UNSET_LABEL = "部署未設定";

function groupAttendeesByDepartment(
  attendees: AttendanceTodayAttendee[],
): AttendanceDepartmentGroup[] {
  const byDept = new Map<string, AttendanceTodayAttendee[]>();
  for (const person of attendees) {
    const dept = person.department?.trim() || DEPARTMENT_UNSET_LABEL;
    const list = byDept.get(dept) ?? [];
    list.push(person);
    byDept.set(dept, list);
  }

  return Array.from(byDept.entries())
    .sort(([a], [b]) => {
      if (a === DEPARTMENT_UNSET_LABEL) return 1;
      if (b === DEPARTMENT_UNSET_LABEL) return -1;
      return a.localeCompare(b, "ja");
    })
    .map(([department, groupAttendees]) => ({
      department,
      attendees: groupAttendees,
    }));
}

async function finalizeTodayAttendees(
  attendees: AttendanceTodayAttendee[],
): Promise<{
  attendees: AttendanceTodayAttendee[];
  byDepartment: AttendanceDepartmentGroup[];
}> {
  try {
    const enriched = await enrichStaffNamesWithDepartments(attendees);
    return {
      attendees: enriched,
      byDepartment: groupAttendeesByDepartment(enriched),
    };
  } catch {
    return {
      attendees,
      byDepartment: groupAttendeesByDepartment(attendees),
    };
  }
}

async function loadAttendanceFieldIds(): Promise<
  | { ok: true; appId: string; ids: AttendanceFieldIds }
  | {
      ok: false;
      status: number;
      error: string;
      configured?: boolean;
      rateLimited?: boolean;
    }
> {
  const appId = attendanceAppId();
  if (!appId) {
    return {
      ok: false,
      status: 503,
      error: "ATTENDANCE_APP_ID が未設定です",
      configured: false,
    };
  }

  const memIds = cachedAttendanceFieldIds(appId);
  if (
    memIds &&
    attendanceFieldsConfigured(memIds) &&
    attendanceFieldsCache &&
    attendanceFieldsCache.expiresAt > Date.now()
  ) {
    return { ok: true, appId, ids: memIds };
  }

  const readAuth = { apiKey: apiKeyForAttendancePocket() };
  if (isPocketApiRateLimited(readAuth) && isAttendanceFetchBlocked()) {
    if (memIds && attendanceFieldsConfigured(memIds)) {
      return { ok: true, appId, ids: memIds };
    }
    return {
      ok: false,
      status: 429,
      error: ATTENDANCE_RATE_LIMIT_MESSAGE,
      rateLimited: true,
    };
  }

  let appFields;
  try {
    appFields = await fetchAppFields(appId, readAuth);
  } catch (e) {
    if (isPocketHttpRateLimitError(e)) {
      markPocketApiRateLimited(readAuth);
      blockAttendanceFetchAfterRateLimit();
      if (memIds && attendanceFieldsConfigured(memIds)) {
        return { ok: true, appId, ids: memIds };
      }
      return {
        ok: false,
        status: 429,
        error: ATTENDANCE_RATE_LIMIT_MESSAGE,
        rateLimited: true,
      };
    }
    const msg = e instanceof Error ? e.message : "勤怠アプリの列定義取得に失敗しました";
    return { ok: false, status: 502, error: msg };
  }

  const fieldIds = resolveAttendanceFieldIds(appFields);
  if (!attendanceFieldsConfigured(fieldIds)) {
    return {
      ok: false,
      status: 503,
      error:
        "勤怠アプリに必要な列（社員名・勤怠日・出勤時刻・退勤時間）が見つかりません。ATTENDANCE_*_FIELD_ID で uniqueId を指定してください",
      configured: false,
    };
  }

  rememberAttendanceFieldIds(appId, fieldIds);
  return { ok: true, appId, ids: fieldIds };
}

/** 勤怠日で本日分を取得（出勤者一覧・個人ステータス兼用・1〜2ページ） */
async function fetchTodayRosterRows(
  appId: string,
  ids: AttendanceFieldIds,
  today: string,
): Promise<AtPocketRecordRow[]> {
  const csv = attendanceFieldsCsv(ids);
  const readAuth = { apiKey: apiKeyForAttendancePocket() };
  const readAuth1 = { apiKey: apiKeyForAttendancePocket1() };

  if (
    isAttendanceFetchBlocked() &&
    isPocketApiRateLimited(readAuth) &&
    isPocketApiRateLimited(readAuth1)
  ) {
    throw new Error("ATTENDANCE_RATE_LIMIT");
  }

  const dateFieldId = ids.workDate?.trim();
  const query = dateFieldId ? `${dateFieldId}="${today}"` : null;
  const pageCap = attendanceRosterMaxPages();
  const all: AtPocketRecordRow[] = [];

  for (let page = 1; page <= pageCap; page++) {
    const auth = page % 2 === 1 ? readAuth : readAuth1;
    if (isPocketApiRateLimited(auth)) break;
    try {
      const data = await fetchRecordsList(
        appId,
        {
          limit: "100",
          page: String(page),
          fields: csv,
          ...(query ? { query } : {}),
        },
        auth,
        { operation: "attendance-roster" },
        { maxRetries: 0 },
      );
      const recs = data.records ?? [];
      all.push(...recs);
      if (recs.length < 100) break;
    } catch (e) {
      if (isPocketHttpRateLimitError(e)) {
        markPocketApiRateLimited(auth);
        blockAttendanceFetchAfterRateLimit();
        throw new Error("ATTENDANCE_RATE_LIMIT");
      }
      if (page === 1) throw e;
      break;
    }
  }

  return all;
}

function matchTodayRecord(
  rows: AtPocketRecordRow[],
  staffName: string,
  ids: AttendanceFieldIds,
  today: string,
): AtPocketRecordRow | null {
  const target = nfkcName(staffName);
  let best: AtPocketRecordRow | null = null;

  for (const row of rows) {
    const recObj = row.record ?? {};
    const name = readFieldText(recObj, ids.staffName);
    if (!name || nfkcName(name) !== target) continue;
    if (!recordAppliesToToday(recObj, ids, today)) continue;

    if (!best) {
      best = row;
      continue;
    }
    const bestIn = readFieldText(best.record ?? {}, ids.clockIn);
    const curIn = readFieldText(recObj, ids.clockIn);
    if (!bestIn && curIn) best = row;
  }

  return best;
}

function statusFromRecord(
  row: AtPocketRecordRow | null,
  ids: AttendanceFieldIds,
): Pick<
  AttendancePublicStatus,
  "clockIn" | "clockOut" | "recordId" | "canClockIn" | "canClockOut"
> {
  if (!row) {
    return {
      clockIn: null,
      clockOut: null,
      recordId: null,
      canClockIn: true,
      canClockOut: false,
    };
  }

  const recObj = row.record ?? {};
  if (!pocketRowHasAttendanceData(recObj, ids)) {
    return {
      clockIn: null,
      clockOut: null,
      recordId: atPocketRecordIdFromRow(row),
      canClockIn: true,
      canClockOut: false,
    };
  }

  const clockIn = readFieldText(recObj, ids.clockIn) || null;
  const clockOut = readFieldText(recObj, ids.clockOut) || null;
  const recordId = atPocketRecordIdFromRow(row);

  return {
    clockIn,
    clockOut,
    recordId,
    canClockIn: !clockIn,
    canClockOut: Boolean(clockIn && !clockOut),
  };
}

function buildFullStatus(
  staffName: string,
  today: string,
  ids: AttendanceFieldIds,
  row: AtPocketRecordRow | null,
  todayAttendees: AttendanceTodayAttendee[],
  todayAttendeesByDepartment: AttendanceDepartmentGroup[],
): AttendancePublicStatus {
  return {
    configured: true,
    staffName,
    workDate: today,
    todayAttendees,
    todayAttendeesByDepartment,
    ...statusFromRecord(row, ids),
  };
}

async function loadTodayAttendanceBundle(
  loaded: { appId: string; ids: AttendanceFieldIds },
  staffName: string,
  today: string,
  bypassRosterCache?: boolean,
): Promise<{
  row: AtPocketRecordRow | null;
  rows: AtPocketRecordRow[];
  todayAttendees: AttendanceTodayAttendee[];
  todayAttendeesByDepartment: AttendanceDepartmentGroup[];
}> {
  const bundle = await getTodayRosterBundleCached(
    today,
    async () => {
      const rosterRows = await fetchTodayRosterRows(
        loaded.appId,
        loaded.ids,
        today,
      );
      const built = buildTodayAttendees(rosterRows, loaded.ids, today);
      const { attendees, byDepartment } = await finalizeTodayAttendees(built);
      return {
        rows: rosterRows,
        attendees,
        byDepartment,
      };
    },
    bypassRosterCache,
  );

  return {
    row: matchTodayRecord(bundle.rows, staffName, loaded.ids, today),
    rows: bundle.rows,
    todayAttendees: bundle.attendees,
    todayAttendeesByDepartment: bundle.byDepartment,
  };
}

async function fetchAttendanceStatusBody(
  loaded: { appId: string; ids: AttendanceFieldIds },
  staffName: string,
  today: string,
  bypassCache?: boolean,
): Promise<AttendancePublicStatus> {
  try {
    const { row, todayAttendees, todayAttendeesByDepartment } =
      await loadTodayAttendanceBundle(loaded, staffName, today, bypassCache);
    return buildFullStatus(
      staffName,
      today,
      loaded.ids,
      row,
      todayAttendees,
      todayAttendeesByDepartment,
    );
  } catch (e) {
    if (e instanceof Error && e.message === "ATTENDANCE_RATE_LIMIT") {
      const stale = getStaleAttendanceStatus(staffName, today);
      if (stale) {
        const roster = getCachedRosterBundle(today);
        return {
          ...stale,
          todayAttendees: roster?.attendees ?? stale.todayAttendees ?? [],
          todayAttendeesByDepartment:
            roster?.byDepartment ?? stale.todayAttendeesByDepartment ?? [],
        };
      }
      const roster = getCachedRosterBundle(today);
      return {
        configured: true,
        staffName,
        workDate: today,
        todayAttendees: roster?.attendees ?? [],
        todayAttendeesByDepartment: roster?.byDepartment ?? [],
        rateLimited: true,
        configError: ATTENDANCE_RATE_LIMIT_MESSAGE,
      };
    }
    throw e;
  }
}

function attendanceStatusOnRateLimit(
  staffName: string | null,
  today: string,
  message: string,
): AttendancePublicStatus {
  if (staffName) {
    const stale = getStaleAttendanceStatus(staffName, today);
    if (stale) {
      const roster = getCachedRosterBundle(today);
      return {
        ...stale,
        configured: true,
        disabled: false,
        rateLimited: true,
        configError: message,
        todayAttendees: roster?.attendees ?? stale.todayAttendees ?? [],
        todayAttendeesByDepartment:
          roster?.byDepartment ?? stale.todayAttendeesByDepartment ?? [],
      };
    }
    const roster = getCachedRosterBundle(today);
    if (roster) {
      return {
        configured: true,
        disabled: false,
        staffName,
        workDate: today,
        rateLimited: true,
        configError: message,
        todayAttendees: roster.attendees,
        todayAttendeesByDepartment: roster.byDepartment,
        canClockIn: false,
        canClockOut: false,
      };
    }
  }
  return {
    configured: true,
    disabled: false,
    workDate: today,
    staffName: staffName ?? undefined,
    rateLimited: true,
    configError: message,
    canClockIn: false,
    canClockOut: false,
  };
}

export async function getAttendanceStatusForLineUser(
  lineUserId: string,
  options?: { bypassCache?: boolean },
): Promise<AttendancePublicStatus> {
  const loaded = await loadAttendanceFieldIds();
  if (!loaded.ok) {
    if (loaded.status === 429 || loaded.rateLimited) {
      const staffName = await resolveBoundStaffNameForLineUser(lineUserId);
      return attendanceStatusOnRateLimit(
        staffName,
        todayYmdJst(),
        loaded.error,
      );
    }
    return {
      configured: loaded.configured !== false,
      disabled: loaded.configured === false,
      configError: loaded.error,
    };
  }

  const staffName = await resolveBoundStaffNameForLineUser(lineUserId);
  if (!staffName) {
    return {
      configured: true,
      needsStaffBind: true,
      configError: "担当者の紐付けが必要です",
    };
  }

  const today = todayYmdJst();
  const key = statusCacheKey(staffName, today);
  const loader = () =>
    fetchAttendanceStatusBody(loaded, staffName, today, options?.bypassCache);

  if (options?.bypassCache) {
    const status = await loader();
    setCachedAttendanceStatus(staffName, today, status);
    return status;
  }

  return getAttendanceStatusCached(key, loader);
}

function syntheticRowAfterPunch(
  existing: AtPocketRecordRow | null,
  ids: AttendanceFieldIds,
  staffName: string,
  today: string,
  kind: "in" | "out",
  now: string,
  recordId: string | null,
): AtPocketRecordRow {
  const base = { ...(existing?.record ?? {}) };
  base[ids.staffName!] = staffName;
  base[ids.workDate!] = today;
  if (kind === "in") {
    base[ids.clockIn!] = now;
  } else {
    base[ids.clockOut!] = now;
    if (!readFieldText(base, ids.clockIn)) {
      base[ids.clockIn!] = now;
    }
  }
  return {
    recordId: recordId ? Number(recordId) : existing?.recordId,
    id: recordId ? Number(recordId) : existing?.id,
    record: base,
  };
}

export async function punchAttendanceForLineUser(
  lineUserId: string,
  kind: "in" | "out",
): Promise<
  | { ok: true; status: AttendancePublicStatus }
  | { ok: false; status: number; error: string; rateLimited?: boolean }
> {
  const loaded = await loadAttendanceFieldIds();
  if (!loaded.ok) {
    return {
      ok: false,
      status: loaded.status,
      error: loaded.error,
      ...(loaded.status === 429 ? { rateLimited: true } : {}),
    };
  }

  const staffName = await resolveBoundStaffNameForLineUser(lineUserId);
  if (!staffName) {
    return {
      ok: false,
      status: 403,
      error: "担当者の紐付けが必要です",
    };
  }

  const { appId, ids } = loaded;
  const today = todayYmdJst();
  const now = nowDateTimeJst();
  const writeAuth = { apiKey: apiKeyForAttendanceWrite() };

  const cached = getCachedAttendanceStatus(staffName, today);
  let existing: AtPocketRecordRow | null = null;
  let rows: AtPocketRecordRow[] = [];

  try {
    const bundle = await loadTodayAttendanceBundle(
      { appId, ids },
      staffName,
      today,
    );
    rows = bundle.rows;
    existing = bundle.row;
  } catch (e) {
    if (e instanceof Error && e.message === "ATTENDANCE_RATE_LIMIT") {
      if (kind === "out" && cached?.recordId && cached.clockIn && !cached.clockOut) {
        existing = {
          recordId: Number(cached.recordId),
          record: {
            [ids.staffName!]: staffName,
            [ids.workDate!]: today,
            [ids.clockIn!]: cached.clockIn,
          },
        };
      } else {
        return {
          ok: false,
          status: 429,
          rateLimited: true,
          error:
            ATTENDANCE_RATE_LIMIT_MESSAGE,
        };
      }
    } else {
      throw e;
    }
  }

  const recObj = existing?.record ?? {};
  const hasDataOnPocket = pocketRowHasAttendanceData(recObj, ids);
  const clockIn = hasDataOnPocket ? readFieldText(recObj, ids.clockIn) : "";
  const clockOut = hasDataOnPocket ? readFieldText(recObj, ids.clockOut) : "";

  const publishPunchStatus = async (
    punchedRow: AtPocketRecordRow | null,
    rosterRows: AtPocketRecordRow[],
  ) => {
    const built = buildTodayAttendees(rosterRows, ids, today);
    const { attendees, byDepartment } = await finalizeTodayAttendees(built);
    setCachedRosterBundle(today, {
      rows: rosterRows,
      attendees,
      byDepartment,
    });
    const status = buildFullStatus(
      staffName,
      today,
      ids,
      punchedRow,
      attendees,
      byDepartment,
    );
    setCachedAttendanceStatus(staffName, today, status);
    return status;
  };

  if (kind === "in") {
    if (clockIn) {
      return {
        ok: false,
        status: 409,
        error: "本日はすでに出勤打刻済みです",
      };
    }

    const patch: Record<string, unknown> = {
      [ids.staffName!]: staffName,
      [ids.workDate!]: today,
      [ids.clockIn!]: now,
    };

    if (existing) {
      const recordId =
        atPocketRecordIdFromRow(existing) ??
        cached?.recordId?.trim() ??
        null;
      if (!recordId) {
        return {
          ok: false,
          status: 502,
          error: "勤怠レコード ID を取得できませんでした",
        };
      }
      await updateRecord(appId, recordId, patch, writeAuth);
      const punchedRow = syntheticRowAfterPunch(
        existing,
        ids,
        staffName,
        today,
        "in",
        now,
        recordId,
      );
      const rosterRows = rows.map((r) =>
        atPocketRecordIdFromRow(r) === recordId ? punchedRow : r,
      );
      const status = await publishPunchStatus(punchedRow, rosterRows);
      return { ok: true, status };
    }

    const created = await createRecord(appId, patch, writeAuth);
    const newId =
      atPocketRecordIdFromRow(created.row) ?? created.recordIdHint ?? null;
    const punchedRow = syntheticRowAfterPunch(
      null,
      ids,
      staffName,
      today,
      "in",
      now,
      newId,
    );
    const rosterRows = [...rows, punchedRow];
    const status = await publishPunchStatus(punchedRow, rosterRows);
    return { ok: true, status };
  }

  if (!clockIn) {
    return {
      ok: false,
      status: 409,
      error: "出勤打刻がありません。先に出勤を打刻してください",
    };
  }
  if (clockOut) {
    return {
      ok: false,
      status: 409,
      error: "本日はすでに退勤打刻済みです",
    };
  }

  const recordId =
    atPocketRecordIdFromRow(existing) ?? cached?.recordId?.trim() ?? null;
  if (!recordId) {
    return {
      ok: false,
      status: 502,
      error: "勤怠レコード ID を取得できませんでした",
    };
  }

  await updateRecord(
    appId,
    recordId,
    { [ids.clockOut!]: now },
    writeAuth,
  );
  const punchedRow = syntheticRowAfterPunch(
    existing,
    ids,
    staffName,
    today,
    "out",
    now,
    recordId,
  );
  const rosterRows = rows.map((r) =>
    atPocketRecordIdFromRow(r) === recordId ? punchedRow : r,
  );
  const status = await publishPunchStatus(punchedRow, rosterRows);
  return { ok: true, status };
}

export type AttendanceMonthCalendarResponse = {
  configured: boolean;
  year: number;
  month: number;
  staffName?: string;
  records: AttendanceDayRecord[];
  needsStaffBind?: boolean;
  configError?: string;
  rateLimited?: boolean;
};

function pad2Month(n: number): string {
  return String(n).padStart(2, "0");
}

function monthDateBounds(year: number, month: number): {
  start: string;
  end: string;
} {
  const last = new Date(year, month, 0).getDate();
  return {
    start: `${year}-${pad2Month(month)}-01`,
    end: `${year}-${pad2Month(month)}-${pad2Month(last)}`,
  };
}

function escapePocketQueryValue(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function ymdInRange(ymd: string, start: string, end: string): boolean {
  return ymd >= start && ymd <= end;
}

function recordWorkYmd(
  recObj: Record<string, unknown>,
  ids: AttendanceFieldIds,
): string | null {
  const fromDate = parseWorkDateYmd(readFieldText(recObj, ids.workDate));
  if (fromDate) return fromDate;
  const fromIn = parseWorkDateYmd(readFieldText(recObj, ids.clockIn));
  if (fromIn) return fromIn;
  return parseWorkDateYmd(readFieldText(recObj, ids.clockOut));
}

function buildMonthDayRecords(
  rows: AtPocketRecordRow[],
  staffName: string,
  ids: AttendanceFieldIds,
  start: string,
  end: string,
): AttendanceDayRecord[] {
  const target = nfkcName(staffName);
  const byDate = new Map<
    string,
    { id: string; checkIn: string; checkOut: string; sortIn: number }
  >();

  for (const row of rows) {
    const recObj = row.record ?? {};
    const name = readFieldText(recObj, ids.staffName);
    if (!name || nfkcName(name) !== target) continue;

    const date = recordWorkYmd(recObj, ids);
    if (!date || !ymdInRange(date, start, end)) continue;

    const checkInRaw = readFieldText(recObj, ids.clockIn);
    const checkOutRaw = readFieldText(recObj, ids.clockOut);
    const checkIn = extractDisplayHHmm(checkInRaw);
    const checkOut = extractDisplayHHmm(checkOutRaw);
    if (!checkIn && !checkOut) continue;

    const id = atPocketRecordIdFromRow(row) || date;
    const sortIn = clockInSortKey(checkInRaw || checkOutRaw);
    const cur = byDate.get(date);
    if (!cur || (checkIn && sortIn < cur.sortIn) || (!cur.checkIn && checkIn)) {
      byDate.set(date, { id, checkIn, checkOut, sortIn });
    }
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      id: v.id,
      date,
      checkIn: v.checkIn,
      checkOut: v.checkOut,
    }));
}

async function fetchMonthAttendanceRows(
  appId: string,
  ids: AttendanceFieldIds,
  staffName: string,
  start: string,
  end: string,
): Promise<AtPocketRecordRow[]> {
  const csv = attendanceFieldsCsv(ids);
  const readAuth = { apiKey: apiKeyForAttendancePocket() };
  const readAuth1 = { apiKey: apiKeyForAttendancePocket1() };
  const staffId = ids.staffName!.trim();
  const dateId = ids.workDate!.trim();
  const staffQ = `${staffId}="${escapePocketQueryValue(staffName)}"`;
  const rangeQ = `${dateId} >= "${start}" and ${dateId} <= "${end}"`;
  const queries = [`${staffQ} and ${rangeQ}`, staffQ];

  if (
    isAttendanceFetchBlocked() &&
    isPocketApiRateLimited(readAuth) &&
    isPocketApiRateLimited(readAuth1)
  ) {
    throw new Error("ATTENDANCE_RATE_LIMIT");
  }

  const merged = new Map<string, AtPocketRecordRow>();
  let anon = 0;

  for (const query of queries) {
    try {
      const rows = await fetchAllRecordsPages(
        appId,
        csv,
        readAuth,
        query,
        { operation: "attendance-month-calendar" },
        {
          maxPages: 5,
          maxRetries: 0,
          authKeys: [readAuth, readAuth1],
        },
      );
      for (const row of rows) {
        const key = atPocketRecordIdFromRow(row) ?? `__anon_${anon++}`;
        if (!merged.has(key)) merged.set(key, row);
      }
      if (merged.size > 0) break;
    } catch (e) {
      if (isPocketHttpRateLimitError(e)) {
        markPocketApiRateLimited(readAuth);
        blockAttendanceFetchAfterRateLimit();
        throw new Error("ATTENDANCE_RATE_LIMIT");
      }
      console.warn("[attendance-month] query failed", {
        query,
        error: String(e),
      });
    }
  }

  return [...merged.values()];
}

/** ログインユーザー本人の月間打刻（出勤・退勤）を返す */
export async function getAttendanceMonthCalendarForLineUser(
  lineUserId: string,
  year: number,
  month: number,
): Promise<AttendanceMonthCalendarResponse> {
  const loaded = await loadAttendanceFieldIds();
  if (!loaded.ok) {
    return {
      configured: loaded.configured !== false,
      year,
      month,
      records: [],
      configError: loaded.error,
      rateLimited: loaded.rateLimited,
    };
  }

  const staffName = await resolveBoundStaffNameForLineUser(lineUserId);
  if (!staffName) {
    return {
      configured: true,
      year,
      month,
      records: [],
      needsStaffBind: true,
      configError: "担当者の紐付けが必要です",
    };
  }

  const { start, end } = monthDateBounds(year, month);

  try {
    const rows = await fetchMonthAttendanceRows(
      loaded.appId,
      loaded.ids,
      staffName,
      start,
      end,
    );
    const records = buildMonthDayRecords(
      rows,
      staffName,
      loaded.ids,
      start,
      end,
    );
    return {
      configured: true,
      year,
      month,
      staffName,
      records,
    };
  } catch (e) {
    if (e instanceof Error && e.message === "ATTENDANCE_RATE_LIMIT") {
      return {
        configured: true,
        year,
        month,
        staffName,
        records: [],
        rateLimited: true,
        configError: ATTENDANCE_RATE_LIMIT_MESSAGE,
      };
    }
    throw e;
  }
}
