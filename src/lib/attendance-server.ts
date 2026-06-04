import "server-only";

import {
  apiKeyForAttendancePocket,
  apiKeyForAttendancePocket1,
  apiKeyForAttendanceWrite,
  createRecord,
  fetchAllRecordsPages,
  fetchAppFields,
  type AtPocketRecordRow,
  updateRecord,
} from "@/lib/atpocket";
import {
  attendanceFieldsConfigured,
  attendanceFieldsCsv,
  resolveAttendanceFieldIds,
  type AttendanceFieldIds,
} from "@/lib/attendance-fields";
import { pickRecordValueByFieldAliases, ymdKey } from "@/lib/calendar-kojo";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export type AttendancePublicStatus = {
  configured: boolean;
  disabled?: boolean;
  configError?: string;
  needsStaffBind?: boolean;
  staffName?: string;
  workDate?: string;
  clockIn?: string | null;
  clockOut?: string | null;
  recordId?: string | null;
  /** 出勤打刻可能 */
  canClockIn?: boolean;
  /** 退勤打刻可能 */
  canClockOut?: boolean;
};

function attendanceAppId(): string | null {
  return process.env.ATTENDANCE_APP_ID?.trim() || null;
}

function attendanceMaxPages(): number {
  const raw = process.env.ATTENDANCE_MAX_PAGES?.trim();
  const n = raw ? Number(raw) : 5;
  if (!Number.isFinite(n) || n < 1) return 5;
  return Math.min(30, Math.floor(n));
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

function recordIdOf(row: AtPocketRecordRow): string | null {
  const id = row.recordId ?? row.id;
  if (id === undefined || id === null) return null;
  return String(id);
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

  const readKeys = [
    apiKeyForAttendancePocket(),
    apiKeyForAttendancePocket1(),
  ];
  let appFields;
  try {
    appFields = await fetchAppFields(appId, { apiKey: readKeys[0] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "勤怠アプリの列定義取得に失敗しました";
    return { ok: false, status: 502, error: msg };
  }

  const ids = resolveAttendanceFieldIds(appFields);
  if (!attendanceFieldsConfigured(ids)) {
    return {
      ok: false,
      status: 503,
      error:
        "勤怠アプリに必要な列（社員名・勤怠日・出勤時刻・退勤時間）が見つかりません。ATTENDANCE_*_FIELD_ID で uniqueId を指定してください",
      configured: false,
    };
  }

  return { ok: true, appId, ids };
}

async function fetchTodayAttendanceRows(
  appId: string,
  ids: AttendanceFieldIds,
): Promise<AtPocketRecordRow[]> {
  const csv = attendanceFieldsCsv(ids);
  const readAuths = [
    { apiKey: apiKeyForAttendancePocket() },
    { apiKey: apiKeyForAttendancePocket1() },
  ];
  return fetchAllRecordsPages(
    appId,
    csv,
    readAuths[0],
    null,
    { operation: "attendance-list" },
    { maxPages: attendanceMaxPages(), authKeys: readAuths },
  );
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

    const dateRaw = readFieldText(recObj, ids.workDate);
    const ymd = parseWorkDateYmd(dateRaw);
    if (ymd !== today) continue;

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
  staffName: string,
  today: string,
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

export async function getAttendanceStatusForLineUser(
  lineUserId: string,
): Promise<AttendancePublicStatus> {
  const loaded = await loadAttendanceFieldIds();
  if (!loaded.ok) {
    return {
      configured: loaded.configured ?? false,
      disabled: !loaded.configured,
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
  const rows = await fetchTodayAttendanceRows(
    loaded.appId,
    loaded.ids,
  );
  const row = matchTodayRecord(rows, staffName, loaded.ids, today);
  const partial = statusFromRecord(row, loaded.ids, staffName, today);

  return {
    configured: true,
    staffName,
    workDate: today,
    ...partial,
  };
}

export async function punchAttendanceForLineUser(
  lineUserId: string,
  kind: "in" | "out",
): Promise<
  | { ok: true; status: AttendancePublicStatus }
  | { ok: false; status: number; error: string }
> {
  const loaded = await loadAttendanceFieldIds();
  if (!loaded.ok) {
    return { ok: false, status: loaded.status, error: loaded.error };
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

  const rows = await fetchTodayAttendanceRows(appId, ids);
  const existing = matchTodayRecord(rows, staffName, ids, today);
  const recObj = existing?.record ?? {};
  const clockIn = readFieldText(recObj, ids.clockIn);
  const clockOut = readFieldText(recObj, ids.clockOut);

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
    } else {
      await createRecord(appId, patch, writeAuth);
    }
  } else {
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
  }

  const status = await getAttendanceStatusForLineUser(lineUserId);
  return { ok: true, status };
}
