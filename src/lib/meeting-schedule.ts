import "server-only";

import {
  apiKeyForSalesDashboardApoPocket,
  fetchAppFields,
} from "@/lib/atpocket";
import {
  coerceCustomerInfoDisplayString,
  readCustomerInfoFieldValue,
} from "@/lib/customer-info-record";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { jstDateKey } from "@/lib/missing-documents-cache";
import {
  meetingScheduleAllowedStatuses,
  meetingScheduleExcludedStatuses,
  resolveMeetingScheduleFieldMap,
  type MeetingScheduleFieldMap,
} from "@/lib/meeting-schedule-fields";
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

function buildMeetingItem(
  recObj: Record<string, unknown>,
  fieldMap: MeetingScheduleFieldMap,
  targetYmd: string,
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

  if (!recordDateMatchesTarget(recObj, fieldMap, targetYmd, estimateStatusStr)) {
    return null;
  }

  const scheduledRaw = readCustomerInfoFieldValue(
    recObj,
    fieldMap.scheduledDate,
  );
  const scheduled = parseScheduledParts(scheduledRaw);

  const timeFromField = fieldMap.meetingTime
    ? coerceCustomerInfoDisplayString(
        readCustomerInfoFieldValue(recObj, fieldMap.meetingTime),
      )
    : "";
  const meetingTime = (timeFromField || scheduled?.time || "").trim();
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
    customerName: customerName.trim(),
    city: formatCityLabel(cityRaw),
    meetingTime: timeMatch?.[1] ?? (meetingTime || "—"),
    apoTypeLabel: apoTypeDisplayLabel(apoType),
    estimateStatus: estimateStatus.trim(),
    meetingPlace: meetingPlace.trim(),
    apPerson,
    clPerson,
    sortMinutes: timeMatch ? parseTimeToMinutes(timeMatch[1]!) : 24 * 60,
  };
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
        date: targetYmd,
        dateLabel: formatMeetingDateLabel(targetYmd),
        staffName: boundStaffName,
        items: [],
        error:
          "商談進捗の必須フィールド（CL担当者・商談日）を特定できません。MEETING_SCHEDULE_*_FIELD_ID を設定してください。",
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
      const recObj = rec as Record<string, unknown>;
      if (!recordMatchesStaff(recObj, fieldMap, boundStaffName)) continue;
      const item = buildMeetingItem(recObj, fieldMap, targetYmd);
      if (item) items.push(item);
    }

    items.sort(
      (a, b) =>
        a.sortMinutes - b.sortMinutes ||
        a.customerName.localeCompare(b.customerName, "ja"),
    );

    return {
      configured: true,
      date: targetYmd,
      dateLabel: formatMeetingDateLabel(targetYmd),
      staffName: boundStaffName,
      items,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[meeting-schedule]", e);
    return {
      configured: true,
      date: targetYmd,
      dateLabel: formatMeetingDateLabel(targetYmd),
      staffName: boundStaffName,
      items: [],
      error: msg || "商談進捗の取得に失敗しました",
    };
  }
}
