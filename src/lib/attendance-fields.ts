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
  /** 取込キー（自動採番など）。POST/PUT で必須 */
  importKey: string | null;
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
    importKey: resolveAttendanceImportKeyFieldId(appFields),
  };
}

const ATTENDANCE_IMPORT_KEY_CAPTIONS = [
  "自動採番",
  "勤怠番号",
  "管理番号",
  "番号",
];

function fieldCaptionLooksLikeAttendanceImportKey(caption: string): boolean {
  const cap = nfkc(caption);
  return (
    cap === "自動採番" ||
    cap.includes("勤怠番号") ||
    cap.includes("管理番号")
  );
}

/** 勤怠アプリの取込キー（自動採番等） */
export function resolveAttendanceImportKeyFieldId(
  appFields: AtPocketFieldRow[],
): string | null {
  const env = process.env.ATTENDANCE_IMPORT_KEY_FIELD_ID?.trim();
  if (env) {
    const id = resolveConfiguredFieldToSchemaUniqueId(env, appFields);
    if (id) return id;
  }
  for (const cap of ATTENDANCE_IMPORT_KEY_CAPTIONS) {
    const id = pickFieldUniqueIdByExactCaption(appFields, cap);
    if (id) return id;
  }
  for (const f of appFields) {
    const id = f.uniqueId?.trim();
    if (!id) continue;
    if (fieldCaptionLooksLikeAttendanceImportKey(f.caption ?? "")) return id;
    const ft = (f.fieldType ?? "").trim();
    if (ft === "AutoNumber" && f.primaryKey) return id;
  }
  for (const f of appFields) {
    const id = f.uniqueId?.trim();
    if (!id) continue;
    if ((f.fieldType ?? "").trim() === "AutoNumber") return id;
  }
  return null;
}

const POCKET_SYSTEM_FIELD_TYPES_ON_CREATE = new Set([
  "RecordId",
  "UniqueId",
  "QRCode",
  "Delete",
  "CreatedAt",
  "CreatorCode",
  "CreatorName",
  "UpdatedAt",
  "UpdaterCode",
  "UpdaterName",
  "AccessUrl",
  "AccessEditUrl",
]);

/**
 * 新規登録用ペイロード調整。
 * 自動採番（キー項目）は @pocket 公式どおり空文字 "" を送って採番させる。
 */
export function applyAttendanceAutoNumberOnCreate(
  payload: Record<string, unknown>,
  appFields: AtPocketFieldRow[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...payload };

  for (const k of Object.keys(out)) {
    const field = appFields.find((f) => f.uniqueId?.trim() === k.trim());
    const ft = (field?.fieldType ?? "").trim();
    if (ft && POCKET_SYSTEM_FIELD_TYPES_ON_CREATE.has(ft)) {
      delete out[k];
    }
  }

  const importKeyId = resolveAttendanceImportKeyFieldId(appFields);
  if (importKeyId) {
    out[importKeyId] = "";
  }

  for (const f of appFields) {
    const id = f.uniqueId?.trim();
    if (!id) continue;
    const ft = (f.fieldType ?? "").trim();
    if (
      ft === "AutoNumber" &&
      (f.primaryKey || fieldCaptionLooksLikeAttendanceImportKey(f.caption ?? ""))
    ) {
      out[id] = "";
    }
  }

  return out;
}

export function attendanceFieldsConfigured(ids: AttendanceFieldIds): boolean {
  return Boolean(
    ids.staffName && ids.workDate && ids.clockIn && ids.clockOut,
  );
}

export function attendanceFieldsCsv(ids: AttendanceFieldIds): string {
  return [
    ids.staffName,
    ids.workDate,
    ids.clockIn,
    ids.clockOut,
    ids.importKey,
  ]
    .filter(Boolean)
    .join(",");
}
