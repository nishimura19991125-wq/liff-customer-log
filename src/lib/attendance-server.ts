import "server-only";

import {
  apiKeyForAttendancePocket,
  apiKeyForAttendancePocket1,
  apiKeyForAttendanceWrite,
  createRecord,
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
  getCachedTodayAttendees,
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
  type AttendanceFieldIds,
  type AttendancePublicStatus,
  type AttendanceTodayAttendee,
} from "@/lib/attendance-fields";
import { pickRecordValueByFieldAliases, ymdKey } from "@/lib/calendar-kojo";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export type { AttendancePublicStatus } from "@/lib/attendance-fields";

function attendanceAppId(): string | null {
  return process.env.ATTENDANCE_APP_ID?.trim() || null;
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

function recordIdOf(row: AtPocketRecordRow): string | null {
  const id = row.recordId ?? row.id;
  if (id === undefined || id === null) return null;
  return String(id);
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

async function loadAttendanceFieldIds(): Promise<
  | { ok: true; appId: string; ids: AttendanceFieldIds }
  | { ok: false; status: number; error: string; configured?: boolean }
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

  const readAuth = { apiKey: apiKeyForAttendancePocket() };
  if (isPocketApiRateLimited(readAuth) && isAttendanceFetchBlocked()) {
    return {
      ok: false,
      status: 429,
      error:
        "データ取得の利用上限に達しました。1〜2分待ってから再度お試しください。",
    };
  }

  let appFields;
  try {
    appFields = await fetchAppFields(appId, readAuth);
  } catch (e) {
    if (isPocketHttpRateLimitError(e)) {
      markPocketApiRateLimited(readAuth);
      blockAttendanceFetchAfterRateLimit();
      return {
        ok: false,
        status: 429,
        error:
          "データ取得の利用上限に達しました。1〜2分待ってから再度お試しください。",
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
      recordId: recordIdOf(row),
      canClockIn: true,
      canClockOut: false,
    };
  }

  const clockIn = readFieldText(recObj, ids.clockIn) || null;
  const clockOut = readFieldText(recObj, ids.clockOut) || null;
  const recordId = recordIdOf(row);

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
): AttendancePublicStatus {
  return {
    configured: true,
    staffName,
    workDate: today,
    todayAttendees,
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
}> {
  const { rows, attendees } = await getTodayRosterBundleCached(
    today,
    async () => {
      const rosterRows = await fetchTodayRosterRows(
        loaded.appId,
        loaded.ids,
        today,
      );
      return {
        rows: rosterRows,
        attendees: buildTodayAttendees(rosterRows, loaded.ids, today),
      };
    },
    bypassRosterCache,
  );

  return {
    row: matchTodayRecord(rows, staffName, loaded.ids, today),
    rows,
    todayAttendees: attendees,
  };
}

async function fetchAttendanceStatusBody(
  loaded: { appId: string; ids: AttendanceFieldIds },
  staffName: string,
  today: string,
  bypassCache?: boolean,
): Promise<AttendancePublicStatus> {
  try {
    const { row, todayAttendees } = await loadTodayAttendanceBundle(
      loaded,
      staffName,
      today,
      bypassCache,
    );
    return buildFullStatus(staffName, today, loaded.ids, row, todayAttendees);
  } catch (e) {
    if (e instanceof Error && e.message === "ATTENDANCE_RATE_LIMIT") {
      const stale = getStaleAttendanceStatus(staffName, today);
      if (stale) {
        const roster = getCachedTodayAttendees(today);
        return {
          ...stale,
          todayAttendees: roster ?? stale.todayAttendees ?? [],
        };
      }
      return {
        configured: true,
        staffName,
        workDate: today,
        todayAttendees: getCachedTodayAttendees(today) ?? [],
        rateLimited: true,
        configError:
          "データ取得の利用上限に達しました。1〜2分待ってから再度お試しください。",
      };
    }
    throw e;
  }
}

export async function getAttendanceStatusForLineUser(
  lineUserId: string,
  options?: { bypassCache?: boolean },
): Promise<AttendancePublicStatus> {
  const loaded = await loadAttendanceFieldIds();
  if (!loaded.ok) {
    return {
      configured: loaded.configured ?? false,
      disabled: !loaded.configured,
      configError: loaded.error,
      ...(loaded.status === 429 ? { rateLimited: true } : {}),
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
            "データ取得の利用上限に達しました。1〜2分待ってから再度お試しください。",
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
      const recordId = recordIdOf(existing);
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
        recordIdOf(r) === recordId ? punchedRow : r,
      );
      const attendees = buildTodayAttendees(rosterRows, ids, today);
      setCachedRosterBundle(today, { rows: rosterRows, attendees });
      const status = buildFullStatus(
        staffName,
        today,
        ids,
        punchedRow,
        attendees,
      );
      setCachedAttendanceStatus(staffName, today, status);
      return { ok: true, status };
    }

    const created = await createRecord(appId, patch, writeAuth);
    const newId =
      recordIdOf(created.row) ?? created.recordIdHint ?? null;
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
    const attendees = buildTodayAttendees(rosterRows, ids, today);
    setCachedRosterBundle(today, { rows: rosterRows, attendees });
    const status = buildFullStatus(
      staffName,
      today,
      ids,
      punchedRow,
      attendees,
    );
    setCachedAttendanceStatus(staffName, today, status);
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

  const recordId = existing ? recordIdOf(existing) : null;
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
    recordIdOf(r) === recordId ? punchedRow : r,
  );
  const attendees = buildTodayAttendees(rosterRows, ids, today);
  setCachedRosterBundle(today, { rows: rosterRows, attendees });
  const status = buildFullStatus(
    staffName,
    today,
    ids,
    punchedRow,
    attendees,
  );
  setCachedAttendanceStatus(staffName, today, status);
  return { ok: true, status };
}
