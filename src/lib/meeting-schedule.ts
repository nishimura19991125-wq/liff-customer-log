import "server-only";

import {
  apiKeyForSalesDashboardApoPocket,
  apiKeyForSalesDashboardApoWrite,
  fetchAppFields,
  fetchRecordById,
  salesDashboardApoWriteConfigured,
  updateRecord,
} from "@/lib/atpocket";
import { atPocketRecordIdFromRow } from "@/lib/atpocket-record-id";
import {
  coerceCustomerInfoDisplayString,
  readCustomerInfoFieldValue,
  readCustomerInfoImportKeyFromRecord,
} from "@/lib/customer-info-record";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { jstDateKey } from "@/lib/missing-documents-cache";
import {
  meetingScheduleAllowedStatuses,
  meetingScheduleCloseTypeOptions,
  meetingScheduleEditableStatuses,
  meetingScheduleExcludedStatuses,
  meetingScheduleImportKeySourceFieldIds,
  meetingScheduleMeetingPlaceOptions,
  resolveMeetingScheduleFieldMap,
  resolveMeetingScheduleImportKeyFieldId,
  type MeetingScheduleFieldMap,
} from "@/lib/meeting-schedule-fields";
import type { MeetingScheduleStatusUpdateInput } from "@/lib/meeting-schedule-status-update";
import { validateMeetingScheduleStatusUpdate } from "@/lib/meeting-schedule-status-update";
import { salesDashboardApoAppId } from "@/lib/sales-dashboard-fields";
import {
  fetchSalesDashboardRecordPages,
  salesDashboardApoListAuths,
} from "@/lib/sales-dashboard-list-fetch";
import type {
  MeetingScheduleItem,
  MeetingSchedulePayload,
} from "@/lib/meeting-schedule-types";

export type { MeetingScheduleItem, MeetingSchedulePayload } from "@/lib/meeting-schedule-types";

function normalizeStatus(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\(/g, "（")
    .replace(/\)/g, "）")
    .trim();
}

function matchesMeetingScheduleStatus(statusRaw: string): boolean {
  const status = normalizeStatus(statusRaw);
  if (!status) return meetingScheduleAllowedStatuses().length === 0;

  for (const ex of meetingScheduleExcludedStatuses()) {
    if (status.includes(normalizeStatus(ex))) return false;
  }

  const allowed = meetingScheduleAllowedStatuses();
  if (!allowed.length) return true;
  return allowed.some((a) => status.includes(normalizeStatus(a)));
}

function apoTypeDisplayLabel(typeVal: string): string {
  const tv = typeVal.trim();
  if (!tv) return "";
  if (tv.includes("ソーラーパートナーズ")) return "SP案件";
  if (tv.includes("ダイレクト")) return "DC案件";
  return tv;
}

function formatCityLabel(raw: string): string {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return "";
  const cityMatch = /(.+?[市区町村郡])/.exec(s);
  if (cityMatch?.[1]) return cityMatch[1]!.trim();
  return s.length > 24 ? `${s.slice(0, 24)}…` : s;
}

function parseScheduledParts(raw: unknown): { ymd: string; time: string } | null {
  const s = coerceCustomerInfoDisplayString(raw);
  if (!s) return null;

  const normalized = s.replace(/\//g, "-").replace("T", " ");
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}:\d{2}(?::\d{2})?))?/.exec(
    normalized,
  );
  if (iso) {
    const ymd = `${iso[1]}-${String(iso[2]).padStart(2, "0")}-${String(iso[3]).padStart(2, "0")}`;
    const time = iso[4]?.slice(0, 5) ?? "";
    return { ymd, time };
  }

  const jp = /^(\d{4})年(\d{1,2})月(\d{1,2})日(?:[ T　]?(\d{1,2}:\d{2}))?/.exec(s);
  if (jp) {
    const ymd = `${jp[1]}-${String(jp[2]).padStart(2, "0")}-${String(jp[3]).padStart(2, "0")}`;
    return { ymd, time: jp[4]?.slice(0, 5) ?? "" };
  }

  const digits = s.replace(/[^\d]/g, "");
  if (digits.length >= 8) {
    const ymd = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    const hm = /(\d{1,2}:\d{2})/.exec(s);
    return { ymd, time: hm?.[1]?.slice(0, 5) ?? "" };
  }

  return null;
}

function parseTimeToMinutes(time: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return 24 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}

function formatMeetingDateLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(`${ymd}T12:00:00+09:00`);
  const w = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
  }).format(d);
  return `${Number(m[2])}月${Number(m[3])}日（${w}）`;
}

function resolveTargetYmd(dateParam: string | null | undefined): string {
  const raw = dateParam?.trim();
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return jstDateKey();
}

function recordMatchesStaff(
  recObj: Record<string, unknown>,
  fieldMap: MeetingScheduleFieldMap,
  boundStaffName: string,
): boolean {
  const bound = normApClStaffName(boundStaffName);
  const cl = normApClStaffName(
    readCustomerInfoFieldValue(recObj, fieldMap.clPerson),
  );
  if (cl && cl === bound) return true;
  if (fieldMap.salesperson) {
    const ap = normApClStaffName(
      readCustomerInfoFieldValue(recObj, fieldMap.salesperson),
    );
    if (ap && ap === bound) return true;
  }
  return false;
}

function isActiveProgressStatus(statusRaw: string): boolean {
  const status = normalizeStatus(statusRaw);
  if (!status) return false;
  for (const ex of meetingScheduleExcludedStatuses()) {
    if (status.includes(normalizeStatus(ex))) return false;
  }
  return status.includes("返待ち") || status.includes("再商談");
}

function recordDateMatchesTarget(
  recObj: Record<string, unknown>,
  fieldMap: MeetingScheduleFieldMap,
  targetYmd: string,
  estimateStatusStr: string,
): boolean {
  const scheduled = parseScheduledParts(
    readCustomerInfoFieldValue(recObj, fieldMap.scheduledDate),
  );
  if (scheduled?.ymd === targetYmd) return true;

  if (fieldMap.meetingDate) {
    const meetingDate = parseScheduledParts(
      readCustomerInfoFieldValue(recObj, fieldMap.meetingDate),
    );
    if (meetingDate?.ymd === targetYmd) return true;
  }

  if (
    targetYmd === jstDateKey() &&
    estimateStatusStr &&
    isActiveProgressStatus(estimateStatusStr)
  ) {
    return true;
  }

  return false;
}

function resolveRecordScheduleYmd(
  recObj: Record<string, unknown>,
  fieldMap: MeetingScheduleFieldMap,
): { ymd: string; time: string } {
  const scheduled = parseScheduledParts(
    readCustomerInfoFieldValue(recObj, fieldMap.scheduledDate),
  );
  if (scheduled?.ymd) return scheduled;

  if (fieldMap.meetingDate) {
    const meetingDate = parseScheduledParts(
      readCustomerInfoFieldValue(recObj, fieldMap.meetingDate),
    );
    if (meetingDate?.ymd) return meetingDate;
  }

  return { ymd: "", time: "" };
}

function scheduleDateLabel(ymd: string): string {
  if (!ymd) return "日付未定";
  return formatMeetingDateLabel(ymd);
}

function sortMeetingItems(items: MeetingScheduleItem[]): void {
  items.sort((a, b) => {
    const dateA = a.scheduledYmd || "9999-12-31";
    const dateB = b.scheduledYmd || "9999-12-31";
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    return (
      a.sortMinutes - b.sortMinutes ||
      a.customerName.localeCompare(b.customerName, "ja")
    );
  });
}

function meetingScheduleMetaExtras(): Pick<
  MeetingSchedulePayload,
  "statusOptions" | "statusEditable" | "closeTypeOptions" | "meetingPlaceOptions"
> {
  return {
    statusOptions: meetingScheduleEditableStatuses(),
    statusEditable: salesDashboardApoWriteConfigured(),
    closeTypeOptions: meetingScheduleCloseTypeOptions(),
    meetingPlaceOptions: meetingScheduleMeetingPlaceOptions(),
  };
}

function resolveFirstMeetingDateYmd(
  recObj: Record<string, unknown>,
  fieldMap: MeetingScheduleFieldMap,
): string {
  if (!fieldMap.meetingDate) return "";
  const parsed = parseScheduledParts(
    readCustomerInfoFieldValue(recObj, fieldMap.meetingDate),
  );
  return parsed?.ymd ?? "";
}

function normalizeEditableStatus(statusRaw: string): string | null {
  const status = normalizeStatus(statusRaw);
  if (!status) return null;
  const options = meetingScheduleEditableStatuses();
  const exact = options.find((o) => normalizeStatus(o) === status);
  if (exact) return exact;
  const partial = options.find((o) => status.includes(normalizeStatus(o)));
  return partial ?? null;
}

function buildMeetingItemFromRecord(
  recObj: Record<string, unknown>,
  fieldMap: MeetingScheduleFieldMap,
  recordId: string,
): MeetingScheduleItem | null {
  const estimateStatus = fieldMap.estimateStatus
    ? coerceCustomerInfoDisplayString(
        readCustomerInfoFieldValue(recObj, fieldMap.estimateStatus),
      )
    : "";
  const estimateStatusStr = estimateStatus.trim();

  if (estimateStatusStr && !matchesMeetingScheduleStatus(estimateStatusStr)) {
    return null;
  }

  const schedule = resolveRecordScheduleYmd(recObj, fieldMap);
  const timeFromField = fieldMap.meetingTime
    ? coerceCustomerInfoDisplayString(
        readCustomerInfoFieldValue(recObj, fieldMap.meetingTime),
      )
    : "";
  const meetingTime = (timeFromField || schedule.time || "").trim();
  const timeMatch = /(\d{1,2}:\d{2})/.exec(meetingTime);

  const customerName = fieldMap.customerName
    ? coerceCustomerInfoDisplayString(
        readCustomerInfoFieldValue(recObj, fieldMap.customerName),
      )
    : "";
  const cityRaw = fieldMap.city
    ? coerceCustomerInfoDisplayString(
        readCustomerInfoFieldValue(recObj, fieldMap.city),
      )
    : "";
  const apoType = fieldMap.apoType
    ? coerceCustomerInfoDisplayString(
        readCustomerInfoFieldValue(recObj, fieldMap.apoType),
      )
    : "";
  const meetingPlace = fieldMap.meetingPlace
    ? coerceCustomerInfoDisplayString(
        readCustomerInfoFieldValue(recObj, fieldMap.meetingPlace),
      )
    : "";
  const closeType = fieldMap.closeType
    ? coerceCustomerInfoDisplayString(
        readCustomerInfoFieldValue(recObj, fieldMap.closeType),
      )
    : "";
  const firstMeetingDateYmd = resolveFirstMeetingDateYmd(recObj, fieldMap);
  const apPerson = fieldMap.salesperson
    ? normApClStaffName(
        readCustomerInfoFieldValue(recObj, fieldMap.salesperson),
      )
    : "";
  const clPerson = normApClStaffName(
    readCustomerInfoFieldValue(recObj, fieldMap.clPerson),
  );

  if (!customerName.trim()) return null;

  return {
    recordId,
    customerName: customerName.trim(),
    city: formatCityLabel(cityRaw),
    meetingTime: timeMatch?.[1] ?? (meetingTime || "—"),
    apoTypeLabel: apoTypeDisplayLabel(apoType),
    estimateStatus: estimateStatusStr,
    meetingPlace: meetingPlace.trim(),
    firstMeetingDateYmd,
    closeType: closeType.trim(),
    apPerson,
    clPerson,
    sortMinutes: timeMatch ? parseTimeToMinutes(timeMatch[1]!) : 24 * 60,
    scheduledYmd: schedule.ymd,
    scheduledDateLabel: scheduleDateLabel(schedule.ymd),
  };
}

function buildMeetingItem(
  recObj: Record<string, unknown>,
  fieldMap: MeetingScheduleFieldMap,
  targetYmd: string,
  recordId: string,
): MeetingScheduleItem | null {
  const estimateStatus = fieldMap.estimateStatus
    ? coerceCustomerInfoDisplayString(
        readCustomerInfoFieldValue(recObj, fieldMap.estimateStatus),
      )
    : "";
  const estimateStatusStr = estimateStatus.trim();

  if (!recordDateMatchesTarget(recObj, fieldMap, targetYmd, estimateStatusStr)) {
    return null;
  }

  return buildMeetingItemFromRecord(recObj, fieldMap, recordId);
}

function formatMeetingScheduleStatusUpdateError(msg: string): string {
  if (msg.includes("アポ通番") && msg.includes("取込設定")) {
    return (
      "@pocket: 取込キー「アポ通番(仮)」を認識できませんでした。アポ取得情報連携の取込設定に「アポ通番(仮)」がキー項目として含まれているか、MEETING_SCHEDULE_IMPORT_KEY_FIELD_ID が管理画面の列識別名と一致しているか確認してください。"
    );
  }
  return msg;
}

export async function updateMeetingScheduleStatusForStaff(
  boundStaffName: string,
  recordIdRaw: string,
  updateInput: MeetingScheduleStatusUpdateInput,
): Promise<
  | { ok: true; estimateStatus: string }
  | { ok: false; status: number; error: string }
> {
  const recordId = recordIdRaw.trim();
  const validated = validateMeetingScheduleStatusUpdate(updateInput);
  if (!validated.ok) {
    return { ok: false, status: 400, error: validated.error };
  }
  const { status: nextStatus, meetingDate, closeType, meetingPlace } =
    validated.normalized;
  if (!recordId) {
    return { ok: false, status: 400, error: "recordId が必要です" };
  }
  const normalizedStatus = normalizeEditableStatus(nextStatus);
  if (!normalizedStatus) {
    return { ok: false, status: 400, error: "変更できないステータスです" };
  }
  if (!salesDashboardApoWriteConfigured()) {
    return {
      ok: false,
      status: 503,
      error:
        "見積ステータスの更新用 API キー（SALES_DASHBOARD_APO_ATPOCKET_API_KEY_2）が未設定です",
    };
  }

  const apoAppId = salesDashboardApoAppId();
  if (!apoAppId) {
    return {
      ok: false,
      status: 503,
      error: "SALES_DASHBOARD_APO_APP_ID が未設定です",
    };
  }

  try {
    const readAuth = { apiKey: apiKeyForSalesDashboardApoPocket() };
    const writeAuth = { apiKey: apiKeyForSalesDashboardApoWrite() };
    const apoFields = await fetchAppFields(apoAppId, readAuth, {
      operation: "meeting-schedule:status-fields",
      appEnv: "SALES_DASHBOARD_APO_APP_ID",
    });
    const fieldMap = resolveMeetingScheduleFieldMap(apoFields);
    if (!fieldMap?.estimateStatus) {
      return {
        ok: false,
        status: 503,
        error: "見積ステータス列を特定できません",
      };
    }

    const importKeyFieldId = resolveMeetingScheduleImportKeyFieldId(apoFields);
    if (!importKeyFieldId) {
      return {
        ok: false,
        status: 503,
        error:
          "取込キー列（アポ通番(仮)）を特定できません。MEETING_SCHEDULE_IMPORT_KEY_FIELD_ID を設定してください。",
      };
    }

    const importKeySources = meetingScheduleImportKeySourceFieldIds();
    const wanted = [
      fieldMap.clPerson,
      fieldMap.salesperson,
      fieldMap.estimateStatus,
      fieldMap.meetingDate,
      fieldMap.closeType,
      fieldMap.meetingPlace,
      importKeyFieldId,
      ...importKeySources,
    ]
      .filter(Boolean)
      .join(",");

    let recRow = await fetchRecordById(apoAppId, recordId, readAuth, wanted);
    if (!recRow?.record) {
      recRow = await fetchRecordById(apoAppId, recordId, readAuth);
    }
    if (!recRow?.record || typeof recRow.record !== "object") {
      return { ok: false, status: 404, error: "レコードが見つかりません" };
    }
    const recObj = recRow.record as Record<string, unknown>;
    if (!recordMatchesStaff(recObj, fieldMap, boundStaffName)) {
      return {
        ok: false,
        status: 403,
        error: "この案件を更新する権限がありません",
      };
    }

    const importKeyValue = readCustomerInfoImportKeyFromRecord(
      recObj,
      importKeyFieldId,
      importKeySources,
    );
    if (!importKeyValue) {
      return {
        ok: false,
        status: 400,
        error:
          "この案件のアポ通番(仮)（取込キー）を取得できませんでした。@pocket に値が入っているか、MEETING_SCHEDULE_IMPORT_KEY_FIELD_ID を確認してください。",
      };
    }

    const payload: Record<string, unknown> = {
      [importKeyFieldId]: importKeyValue,
      [fieldMap.estimateStatus]: normalizedStatus,
    };

    if (meetingDate && fieldMap.meetingDate) {
      payload[fieldMap.meetingDate] = meetingDate;
    } else if (meetingDate && !fieldMap.meetingDate) {
      return {
        ok: false,
        status: 503,
        error: "初回商談実施日列を特定できません",
      };
    }

    if (closeType && fieldMap.closeType) {
      payload[fieldMap.closeType] = closeType;
    } else if (closeType && !fieldMap.closeType) {
      return {
        ok: false,
        status: 503,
        error: "片クロor両クロ列を特定できません",
      };
    }

    if (meetingPlace && fieldMap.meetingPlace) {
      payload[fieldMap.meetingPlace] = meetingPlace;
    } else if (meetingPlace && !fieldMap.meetingPlace) {
      return {
        ok: false,
        status: 503,
        error: "商談場所列を特定できません",
      };
    }

    await updateRecord(apoAppId, recordId, payload, writeAuth);

    return { ok: true, estimateStatus: normalizedStatus };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[meeting-schedule:status]", e);
    return {
      ok: false,
      status: 502,
      error: formatMeetingScheduleStatusUpdateError(
        msg || "見積ステータスの更新に失敗しました",
      ),
    };
  }
}

export async function buildMeetingScheduleForStaff(
  boundStaffName: string,
  dateParam?: string | null,
): Promise<MeetingSchedulePayload> {
  const apoAppId = salesDashboardApoAppId();
  const targetYmd = resolveTargetYmd(dateParam);

  if (!apoAppId) {
    return {
      configured: false,
      scope: "day",
      date: targetYmd,
      dateLabel: formatMeetingDateLabel(targetYmd),
      staffName: boundStaffName,
      items: [],
      error: "SALES_DASHBOARD_APO_APP_ID が未設定です",
    };
  }

  try {
    const fieldAuth = { apiKey: apiKeyForSalesDashboardApoPocket() };
    const listAuths = salesDashboardApoListAuths();
    const apoFields = await fetchAppFields(apoAppId, fieldAuth, {
      operation: "meeting-schedule:fields",
      appEnv: "SALES_DASHBOARD_APO_APP_ID",
    });
    const fieldMap = resolveMeetingScheduleFieldMap(apoFields);
    if (!fieldMap) {
      return {
        configured: false,
        scope: "day",
        date: targetYmd,
        dateLabel: formatMeetingDateLabel(targetYmd),
        staffName: boundStaffName,
        items: [],
        error:
          "商談進捗情報の必須フィールド（CL担当者・商談日）を特定できません。MEETING_SCHEDULE_*_FIELD_ID を設定してください。",
      };
    }

    const wanted = [
      fieldMap.clPerson,
      fieldMap.scheduledDate,
      fieldMap.salesperson,
      fieldMap.customerName,
      fieldMap.city,
      fieldMap.meetingTime,
      fieldMap.estimateStatus,
      fieldMap.apoType,
      fieldMap.meetingPlace,
      fieldMap.meetingDate,
      fieldMap.closeType,
    ]
      .filter(Boolean)
      .join(",");

    const records = await fetchSalesDashboardRecordPages(
      apoAppId,
      wanted,
      listAuths,
      {
        operation: "meeting-schedule:records",
        appEnv: "SALES_DASHBOARD_APO_APP_ID",
      },
    );
    const items: MeetingScheduleItem[] = [];

    for (const row of records) {
      const rec = row.record;
      if (!rec || typeof rec !== "object") continue;
      const recordId = atPocketRecordIdFromRow(row);
      if (!recordId) continue;
      const recObj = rec as Record<string, unknown>;
      if (!recordMatchesStaff(recObj, fieldMap, boundStaffName)) continue;
      const item = buildMeetingItem(recObj, fieldMap, targetYmd, recordId);
      if (item) items.push(item);
    }

    items.sort(
      (a, b) =>
        a.sortMinutes - b.sortMinutes ||
        a.customerName.localeCompare(b.customerName, "ja"),
    );

    return {
      configured: true,
      scope: "day",
      date: targetYmd,
      dateLabel: formatMeetingDateLabel(targetYmd),
      staffName: boundStaffName,
      items,
      ...meetingScheduleMetaExtras(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[meeting-schedule]", e);
    return {
      configured: true,
      scope: "day",
      date: targetYmd,
      dateLabel: formatMeetingDateLabel(targetYmd),
      staffName: boundStaffName,
      items: [],
      error: msg || "商談進捗情報の取得に失敗しました",
    };
  }
}

export async function buildMeetingScheduleListForStaff(
  boundStaffName: string,
): Promise<MeetingSchedulePayload> {
  const apoAppId = salesDashboardApoAppId();

  if (!apoAppId) {
    return {
      configured: false,
      scope: "list",
      staffName: boundStaffName,
      items: [],
      error: "SALES_DASHBOARD_APO_APP_ID が未設定です",
    };
  }

  try {
    const fieldAuth = { apiKey: apiKeyForSalesDashboardApoPocket() };
    const listAuths = salesDashboardApoListAuths();
    const apoFields = await fetchAppFields(apoAppId, fieldAuth, {
      operation: "meeting-schedule:fields",
      appEnv: "SALES_DASHBOARD_APO_APP_ID",
    });
    const fieldMap = resolveMeetingScheduleFieldMap(apoFields);
    if (!fieldMap) {
      return {
        configured: false,
        scope: "list",
        staffName: boundStaffName,
        items: [],
        error:
          "商談進捗情報の必須フィールド（CL担当者・商談日）を特定できません。MEETING_SCHEDULE_*_FIELD_ID を設定してください。",
      };
    }

    const wanted = [
      fieldMap.clPerson,
      fieldMap.scheduledDate,
      fieldMap.salesperson,
      fieldMap.customerName,
      fieldMap.city,
      fieldMap.meetingTime,
      fieldMap.estimateStatus,
      fieldMap.apoType,
      fieldMap.meetingPlace,
      fieldMap.meetingDate,
      fieldMap.closeType,
    ]
      .filter(Boolean)
      .join(",");

    const records = await fetchSalesDashboardRecordPages(
      apoAppId,
      wanted,
      listAuths,
      {
        operation: "meeting-schedule:records-list",
        appEnv: "SALES_DASHBOARD_APO_APP_ID",
      },
    );
    const items: MeetingScheduleItem[] = [];

    for (const row of records) {
      const rec = row.record;
      if (!rec || typeof rec !== "object") continue;
      const recordId = atPocketRecordIdFromRow(row);
      if (!recordId) continue;
      const recObj = rec as Record<string, unknown>;
      if (!recordMatchesStaff(recObj, fieldMap, boundStaffName)) continue;
      const item = buildMeetingItemFromRecord(recObj, fieldMap, recordId);
      if (item) items.push(item);
    }

    sortMeetingItems(items);

    return {
      configured: true,
      scope: "list",
      staffName: boundStaffName,
      items,
      ...meetingScheduleMetaExtras(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[meeting-schedule:list]", e);
    return {
      configured: true,
      scope: "list",
      staffName: boundStaffName,
      items: [],
      error: msg || "商談進捗情報の取得に失敗しました",
    };
  }
}
