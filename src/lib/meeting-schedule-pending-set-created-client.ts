import { isMeetingScheduleSetCreatedStatus } from "@/lib/meeting-schedule-shared";
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

function sortPastSetCreatedItems(items: MeetingScheduleItem[]): MeetingScheduleItem[] {
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

/** 本日より前の商談で見積ステータスが商談セット作成済みの案件（前日以前すべて） */
export async function fetchPastSetCreatedMeetings(
  idToken: string,
): Promise<MeetingScheduleItem[]> {
  const todayYmd = todayYmdJst();
  try {
    const res = await fetch("/api/meeting-schedule?scope=list", {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as MeetingSchedulePayload & {
      disabled?: boolean;
      needsStaffBind?: boolean;
    };
    if (!data.configured || data.error) return [];
    const items = (data.items ?? []).filter(
      (item) =>
        isMeetingScheduleSetCreatedStatus(item.estimateStatus) &&
        isScheduledBeforeToday(item.scheduledYmd, todayYmd),
    );
    return sortPastSetCreatedItems(items);
  } catch {
    return [];
  }
}
