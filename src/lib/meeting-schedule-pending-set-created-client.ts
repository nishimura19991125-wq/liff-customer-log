import {
  isMeetingScheduleSetCreatedStatus,
  isScheduledBeforeToday,
  needsMeetingScheduleHenmachiAlert,
} from "@/lib/meeting-schedule-shared";
import type {
  MeetingScheduleAlertItem,
  MeetingScheduleItem,
  MeetingSchedulePayload,
} from "@/lib/meeting-schedule-types";

export function todayYmdJst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );
}

function sortPendingAlertItems(
  items: MeetingScheduleAlertItem[],
): MeetingScheduleAlertItem[] {
  return [...items].sort((a, b) => {
    const kindOrder = { "set-created": 0, henmachi: 1 };
    if (kindOrder[a.alertKind] !== kindOrder[b.alertKind]) {
      return kindOrder[a.alertKind] - kindOrder[b.alertKind];
    }
    const dateA = a.scheduledYmd || "0000-00-00";
    const dateB = b.scheduledYmd || "0000-00-00";
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    return (
      a.sortMinutes - b.sortMinutes ||
      a.customerName.localeCompare(b.customerName, "ja")
    );
  });
}

export function filterPendingMeetingAlerts(
  items: MeetingScheduleItem[],
  todayYmd = todayYmdJst(),
): MeetingScheduleAlertItem[] {
  const alerts: MeetingScheduleAlertItem[] = [];

  for (const item of items) {
    if (
      isMeetingScheduleSetCreatedStatus(item.estimateStatus) &&
      isScheduledBeforeToday(item.scheduledYmd, todayYmd)
    ) {
      alerts.push({ ...item, alertKind: "set-created" });
      continue;
    }
    if (needsMeetingScheduleHenmachiAlert(item, todayYmd)) {
      alerts.push({ ...item, alertKind: "henmachi" });
    }
  }

  return sortPendingAlertItems(alerts);
}

/** @deprecated filterPendingMeetingAlerts を使用してください */
export function filterPendingSetCreatedMeetings(
  items: MeetingScheduleItem[],
  todayYmd = todayYmdJst(),
): MeetingScheduleItem[] {
  return filterPendingMeetingAlerts(items, todayYmd).filter(
    (item) => item.alertKind === "set-created",
  );
}

/** 出勤後アラート対象の商談進捗案件 */
export async function fetchPendingMeetingAlerts(
  idToken: string,
): Promise<MeetingScheduleAlertItem[]> {
  try {
    const res = await fetch("/api/meeting-schedule?scope=list", {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as MeetingSchedulePayload & {
      disabled?: boolean;
      needsStaffBind?: boolean;
    };
    if (!data.configured || data.error || data.needsStaffBind) return [];
    return filterPendingMeetingAlerts(data.items ?? []);
  } catch {
    return [];
  }
}

/** @deprecated fetchPendingMeetingAlerts を使用してください */
export async function fetchPastSetCreatedMeetings(
  idToken: string,
): Promise<MeetingScheduleItem[]> {
  const alerts = await fetchPendingMeetingAlerts(idToken);
  return alerts.filter((item) => item.alertKind === "set-created");
}

export const MEETING_SET_CREATED_ALERT_CHECK_EVENT =
  "meeting-set-created-alert-check";

export function requestMeetingSetCreatedAlertCheck(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(MEETING_SET_CREATED_ALERT_CHECK_EVENT));
}
