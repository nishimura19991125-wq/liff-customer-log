import "server-only";

import {
  apiKeyForWorkEndReportPocket,
  apiKeyForWorkEndReportPocket1,
  apiKeyForWorkEndReportWrite,
  createRecord,
  fetchAppFields,
  fetchRecordsList,
  type AtPocketRecordRow,
} from "@/lib/atpocket";
import { atPocketRecordIdFromRow } from "@/lib/atpocket-record-id";
import { pickRecordValueByFieldAliases, ymdKey } from "@/lib/calendar-kojo";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";
import { lookupStaffDepartmentByStaffName } from "@/lib/staff-department-lookup";
import { resolveWorkEndReportAppId } from "@/lib/work-end-report-config";
import {
  resolveWorkEndReportFieldIds,
  workEndReportFieldsConfigured,
  workEndReportFieldsCsv,
  type WorkEndReportFieldIds,
} from "@/lib/work-end-report-fields";
import {
  WORK_END_REPORT_APO_ACTIVITY_OPTIONS,
  isWorkEndApoActivityImplemented,
  type WorkEndReportFormValues,
  type WorkEndReportRecordSnapshot,
  type WorkEndReportStatus,
} from "@/lib/work-end-report-types";

export type { WorkEndReportStatus } from "@/lib/work-end-report-types";

const FIELDS_CACHE_MS = 3_600_000;
let fieldsCache: {
  appId: string;
  ids: WorkEndReportFieldIds;
  expiresAt: number;
} | null = null;

function todayYmdJst(): string {
  const d = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }),
  );
  return ymdKey(d);
}

function nfkcName(s: string): string {
  return s.normalize("NFKC").trim();
}

function readFieldText(
  recObj: Record<string, unknown>,
  fieldId: string | null,
): string {
  if (!fieldId) return "";
  const raw = pickRecordValueByFieldAliases(recObj, fieldId);
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "object" && raw !== null && "value" in raw) {
    const v = (raw as { value?: unknown }).value;
    return v === null || v === undefined ? "" : nfkcName(String(v));
  }
  return nfkcName(String(raw));
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
  ids: WorkEndReportFieldIds,
  today: string,
): boolean {
  const dateYmd = parseWorkDateYmd(readFieldText(recObj, ids.reportDate));
  return dateYmd === today;
}

function snapshotFromRecord(
  recObj: Record<string, unknown>,
  ids: WorkEndReportFieldIds,
): WorkEndReportRecordSnapshot {
  return {
    pinponCount: readFieldText(recObj, ids.pinponCount) || undefined,
    meetingCount: readFieldText(recObj, ids.meetingCount) || undefined,
    apoCount: readFieldText(recObj, ids.apoCount) || undefined,
    apoActivity: readFieldText(recObj, ids.apoActivity) || undefined,
    workArea: readFieldText(recObj, ids.workArea) || undefined,
  };
}

function apoActivityOptions(): readonly string[] {
  return WORK_END_REPORT_APO_ACTIVITY_OPTIONS;
}

function workEndReportMaxPages(): number {
  const raw = process.env.WORK_END_REPORT_MAX_PAGES?.trim();
  const n = raw ? Number(raw) : 2;
  if (!Number.isFinite(n) || n < 1) return 2;
  return Math.min(10, Math.floor(n));
}

function parseNonNegativeCount(
  label: string,
  raw: string | undefined,
  required: boolean,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    if (required) {
      return { ok: false, error: `${label}を入力してください` };
    }
    return { ok: true, value: null };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: `${label}は0以上の整数で入力してください` };
  }
  return { ok: true, value: String(Number(trimmed)) };
}

async function loadWorkEndReportFieldIds(): Promise<
  | { ok: true; appId: string; ids: WorkEndReportFieldIds }
  | { ok: false; status: number; error: string }
> {
  const resolved = await resolveWorkEndReportAppId();
  if (!resolved.appId) {
    return {
      ok: false,
      status: 503,
      error: resolved.error ?? "稼働終了報告アプリが未設定です",
    };
  }

  const appId = resolved.appId;

  if (
    fieldsCache &&
    fieldsCache.appId === appId &&
    fieldsCache.expiresAt > Date.now()
  ) {
    return { ok: true, appId, ids: fieldsCache.ids };
  }

  const appFields = await fetchAppFields(
    appId,
    { apiKey: apiKeyForWorkEndReportPocket1() },
    { operation: "work-end:fields", appEnv: "WORK_END_REPORT_APP_ID" },
  );

  const ids = resolveWorkEndReportFieldIds(appFields);
  if (!workEndReportFieldsConfigured(ids)) {
    return {
      ok: false,
      status: 503,
      error:
        "稼働終了報告アプリに必要な列（報告者・ピンポン数・面談数・アポ獲得数・アポ活動実施・報告日・稼働エリア）が見つかりません。WORK_END_REPORT_*_FIELD_ID で uniqueId を指定してください。",
    };
  }

  fieldsCache = {
    appId,
    ids,
    expiresAt: Date.now() + FIELDS_CACHE_MS,
  };

  return { ok: true, appId, ids };
}

async function fetchTodayReportRows(
  appId: string,
  ids: WorkEndReportFieldIds,
): Promise<AtPocketRecordRow[]> {
  const csv = workEndReportFieldsCsv(ids);
  const readAuth = { apiKey: apiKeyForWorkEndReportPocket() };
  const pageCap = workEndReportMaxPages();
  const all: AtPocketRecordRow[] = [];

  for (let page = 1; page <= pageCap; page++) {
    const res = await fetchRecordsList(
      appId,
      { page: String(page), fields: csv },
      readAuth,
      { operation: "work-end:一覧", appEnv: "WORK_END_REPORT_APP_ID" },
    );
    const recs = res.records ?? [];
    all.push(...recs);
    if (recs.length < 100) break;
  }

  return all;
}

function matchTodayReport(
  rows: AtPocketRecordRow[],
  staffName: string,
  ids: WorkEndReportFieldIds,
  today: string,
): AtPocketRecordRow | null {
  const target = nfkcName(staffName);

  for (const row of rows) {
    const recObj = row.record ?? {};
    const name = readFieldText(recObj, ids.reporter);
    if (!name || nfkcName(name) !== target) continue;
    if (!recordAppliesToToday(recObj as Record<string, unknown>, ids, today)) {
      continue;
    }
    return row;
  }

  return null;
}

async function lookupStaffDepartment(
  staffName: string,
): Promise<string | null> {
  return lookupStaffDepartmentByStaffName(staffName);
}

export async function getWorkEndReportStatusForLineUser(
  lineUserId: string,
): Promise<WorkEndReportStatus> {
  const today = todayYmdJst();
  const staffName = await resolveBoundStaffNameForLineUser(lineUserId);
  if (!staffName) {
    return {
      configured: true,
      needsStaffBind: true,
      reportDate: today,
      canReport: false,
    };
  }

  const loaded = await loadWorkEndReportFieldIds();
  if (!loaded.ok) {
    return {
      configured: false,
      configError: loaded.error,
      staffName,
      reportDate: today,
      canReport: false,
    };
  }

  const department = await lookupStaffDepartment(staffName);

  const { appId, ids } = loaded;
  let existing: AtPocketRecordRow | null = null;

  try {
    const rows = await fetchTodayReportRows(appId, ids);
    existing = matchTodayReport(rows, staffName, ids, today);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      configured: true,
      configError: `稼働終了報告の取得に失敗しました: ${msg}`,
      staffName,
      reportDate: today,
      canReport: false,
    };
  }

  const recObj = (existing?.record ?? {}) as Record<string, unknown>;
  const existingReport = existing ? snapshotFromRecord(recObj, ids) : null;

  return {
    configured: true,
    staffName,
    reportDate: today,
    reportedAt: existing ? today : null,
    recordId: existing ? atPocketRecordIdFromRow(existing) : null,
    canReport: !existing,
    department,
    existingReport,
  };
}

export async function submitWorkEndReportForLineUser(
  lineUserId: string,
  input: WorkEndReportFormValues,
): Promise<
  | { ok: true; status: WorkEndReportStatus }
  | { ok: false; status: number; error: string; needsStaffBind?: boolean }
> {
  const today = todayYmdJst();
  const staffName = await resolveBoundStaffNameForLineUser(lineUserId);
  if (!staffName) {
    return {
      ok: false,
      status: 403,
      error: "担当者の紐付けが必要です",
      needsStaffBind: true,
    };
  }

  const apoActivityOptionsList = apoActivityOptions();
  const apoActivity = input.apoActivity?.trim() ?? "";
  if (!apoActivity) {
    return { ok: false, status: 400, error: "アポ活動実施を選択してください" };
  }
  if (!apoActivityOptionsList.includes(apoActivity)) {
    return {
      ok: false,
      status: 400,
      error: `アポ活動実施は「実施」または「未実施」を選んでください`,
    };
  }

  const apoActivityRequired = isWorkEndApoActivityImplemented(apoActivity);

  const workArea = input.workArea?.trim() ?? "";
  if (apoActivityRequired && !workArea) {
    return { ok: false, status: 400, error: "稼働エリアを入力してください" };
  }

  const pinpon = parseNonNegativeCount(
    "ピンポン数",
    input.pinponCount,
    apoActivityRequired,
  );
  if (!pinpon.ok) return { ok: false, status: 400, error: pinpon.error };
  const meeting = parseNonNegativeCount(
    "面談数",
    input.meetingCount,
    apoActivityRequired,
  );
  if (!meeting.ok) return { ok: false, status: 400, error: meeting.error };
  const apo = parseNonNegativeCount(
    "アポ獲得数",
    input.apoCount,
    apoActivityRequired,
  );
  if (!apo.ok) return { ok: false, status: 400, error: apo.error };

  const loaded = await loadWorkEndReportFieldIds();
  if (!loaded.ok) {
    return { ok: false, status: loaded.status, error: loaded.error };
  }

  const { appId, ids } = loaded;

  const rows = await fetchTodayReportRows(appId, ids);
  const existing = matchTodayReport(rows, staffName, ids, today);
  if (existing) {
    return {
      ok: false,
      status: 409,
      error: "本日はすでに稼働終了報告済みです",
    };
  }

  const payload: Record<string, string | number> = {
    [ids.reporter!]: staffName,
    [ids.reportDate!]: today,
    [ids.apoActivity!]: apoActivity,
  };
  if (pinpon.value != null) payload[ids.pinponCount!] = pinpon.value;
  if (meeting.value != null) payload[ids.meetingCount!] = meeting.value;
  if (apo.value != null) payload[ids.apoCount!] = apo.value;
  if (workArea) payload[ids.workArea!] = workArea;

  const writeAuth = { apiKey: apiKeyForWorkEndReportWrite() };
  await createRecord(appId, payload, writeAuth);

  const status = await getWorkEndReportStatusForLineUser(lineUserId);

  return {
    ok: true,
    status: {
      ...status,
      reported: true,
      reportedAt: today,
      canReport: false,
    },
  };
}
