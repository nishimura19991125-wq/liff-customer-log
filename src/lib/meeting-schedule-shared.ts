export const MEETING_SCHEDULE_SET_CREATED_STATUS = "商談セット作成済み";

export function isMeetingScheduleSetCreatedStatus(statusRaw: string): boolean {
  return statusRaw
    .normalize("NFKC")
    .trim()
    .includes(MEETING_SCHEDULE_SET_CREATED_STATUS);
}
