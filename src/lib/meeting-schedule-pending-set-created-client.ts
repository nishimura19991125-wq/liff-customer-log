import {
  needsMeetingScheduleSetCreatedInput,
} from "@/lib/meeting-schedule-shared";
import type {
  MeetingScheduleItem,
  MeetingSchedulePayload,
} from "@/lib/meeting-schedule-types";

export function todayYmdJst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );
}

function isScheduledBeforeToday(
  scheduledYmd: string,
  todayYmd: string,
): boolean {
  const ymd = scheduledYmd.trim();
  if (!ymd) return true;
  return ymd < todayYmd;
}

function sortPastSetCreatedItems(
  items: MeetingScheduleItem[],
): MeetingScheduleItem[] {
  return [...items].sort((a, b) => {
    const dateA = a.scheduledYmd || "0000-00-00";
    const dateB = b.scheduledYmd || "0000-00-00";
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    return (
      a.sortMinutes - b.sortMinutes ||
      a.customerName.localeCompare(b.customerName, "ja")
    );
  });
}

export function filterPendingSetCreatedMeetings(
  items: MeetingScheduleItem[],
  todayYmd = todayYmdJst(),
): MeetingScheduleItem[] {
  return sortPastSetCreatedItems(
    items.filter(
      (item) =>
        needsMeetingScheduleSetCreatedInput(item) &&
        isScheduledBeforeToday(item.scheduledYmd, todayYmd),
    ),
  );
}

/** 本日より前の商談で商談セット作成済みかつ未入力の案件 */
export async function fetchPastSetCreatedMeetings(
  idToken: string,
): Promise<MeetingScheduleItem[]> {
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
    return filterPendingSetCreatedMeetings(data.items ?? []);
  } catch {
    return [];
  }
}

export const MEETING_SET_CREATED_ALERT_CHECK_EVENT =
  "meeting-set-created-alert-check";

export function requestMeetingSetCreatedAlertCheck(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(MEETING_SET_CREATED_ALERT_CHECK_EVENT));
}
