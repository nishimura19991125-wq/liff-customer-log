import { isMeetingScheduleSetCreatedStatus } from "@/lib/meeting-schedule-shared";
import type {
  MeetingScheduleItem,
  MeetingSchedulePayload,
} from "@/lib/meeting-schedule-types";

export function yesterdayYmdJst(): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
  }).format(new Date());
  const d = new Date(`${today}T12:00:00+09:00`);
  d.setDate(d.getDate() - 1);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(d);
}

export function yesterdayDateLabelJst(): string {
  const ymd = yesterdayYmdJst();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(`${ymd}T12:00:00+09:00`);
  const w = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
  }).format(d);
  return `${Number(m[2])}月${Number(m[3])}日（${w}）`;
}

/** 前日（JST）の商談で見積ステータスが商談セット作成済みの案件 */
export async function fetchYesterdaySetCreatedMeetings(
  idToken: string,
): Promise<MeetingScheduleItem[]> {
  const ymd = yesterdayYmdJst();
  try {
    const res = await fetch(
      `/api/meeting-schedule?date=${encodeURIComponent(ymd)}`,
      { headers: { Authorization: `Bearer ${idToken}` } },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as MeetingSchedulePayload & {
      disabled?: boolean;
      needsStaffBind?: boolean;
    };
    if (!data.configured || data.error) return [];
    return (data.items ?? []).filter((item) =>
      isMeetingScheduleSetCreatedStatus(item.estimateStatus),
    );
  } catch {
    return [];
  }
}
