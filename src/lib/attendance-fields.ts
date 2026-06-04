import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

function pickFieldUniqueIdByExactCaption(
  fields: AtPocketFieldRow[],
  caption: string,
): string | null {
  const target = nfkc(caption).toLowerCase();
  for (const f of fields) {
    const cap = f.caption ? nfkc(String(f.caption)).toLowerCase() : "";
    if (cap && cap === target) {
      const id = f.uniqueId?.trim();
      return id || null;
    }
  }
  return null;
}

function pickFieldUniqueIdByCaptions(
  fields: AtPocketFieldRow[],
  captions: string[],
): string | null {
  for (const caption of captions) {
    const id = pickFieldUniqueIdByExactCaption(fields, caption);
    if (id) return id;
  }
  return null;
}

function resolveSchemaFieldId(
  configuredId: string | undefined,
  fields: AtPocketFieldRow[],
  captionAlts: string[],
): string | null {
  const fromEnv = configuredId?.trim();
  if (fromEnv) {
    return resolveConfiguredFieldToSchemaUniqueId(fromEnv, fields);
  }
  const picked = pickFieldUniqueIdByCaptions(fields, captionAlts);
  if (!picked) return null;
  return resolveConfiguredFieldToSchemaUniqueId(picked, fields) ?? picked;
}

export type AttendanceFieldIds = {
  staffName: string | null;
  workDate: string | null;
  clockIn: string | null;
  clockOut: string | null;
};

/** 本日すでに出勤打刻した人（一覧表示用） */
export type AttendanceTodayAttendee = {
  staffName: string;
  clockIn: string;
  clockOut: string | null;
  /** スタッフ名簿の部署（見出し「部署」等・未設定時は省略） */
  department?: string;
};

/** 部署ごとの出勤者グループ */
export type AttendanceDepartmentGroup = {
  department: string;
  attendees: AttendanceTodayAttendee[];
};

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
  canClockIn?: boolean;
  canClockOut?: boolean;
  /** 本日の出勤者（出勤時刻あり・社員名で重複排除） */
  todayAttendees?: AttendanceTodayAttendee[];
  /** 部署ごとにまとめた出勤者（表示用） */
  todayAttendeesByDepartment?: AttendanceDepartmentGroup[];
  rateLimited?: boolean;
  stale?: boolean;
};

export function resolveAttendanceFieldIds(
  appFields: AtPocketFieldRow[],
): AttendanceFieldIds {
  return {
    staffName: resolveSchemaFieldId(
      process.env.ATTENDANCE_STAFF_NAME_FIELD_ID,
      appFields,
      ["社員名", "担当者", "報告者", "営業担当", "氏名"],
    ),
    workDate: resolveSchemaFieldId(
      process.env.ATTENDANCE_DATE_FIELD_ID,
      appFields,
      ["勤怠日", "日付", "勤務日", "出勤日"],
    ),
    clockIn: resolveSchemaFieldId(
      process.env.ATTENDANCE_CLOCK_IN_FIELD_ID,
      appFields,
      ["出勤時刻", "出勤", "出勤時間"],
    ),
    clockOut: resolveSchemaFieldId(
      process.env.ATTENDANCE_CLOCK_OUT_FIELD_ID,
      appFields,
      ["退勤時間", "退勤時刻", "退勤"],
    ),
  };
}

export function attendanceFieldsConfigured(ids: AttendanceFieldIds): boolean {
  return Boolean(
    ids.staffName && ids.workDate && ids.clockIn && ids.clockOut,
  );
}

export function attendanceFieldsCsv(ids: AttendanceFieldIds): string {
  return [ids.staffName, ids.workDate, ids.clockIn, ids.clockOut]
    .filter(Boolean)
    .join(",");
}
