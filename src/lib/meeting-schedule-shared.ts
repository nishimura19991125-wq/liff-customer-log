export const MEETING_SCHEDULE_SET_CREATED_STATUS = "商談セット作成済み";

export function isMeetingScheduleSetCreatedStatus(statusRaw: string): boolean {
  return statusRaw
    .normalize("NFKC")
    .trim()
    .includes(MEETING_SCHEDULE_SET_CREATED_STATUS);
}

export function needsMeetingScheduleSetCreatedInput(item: {
  estimateStatus: string;
  firstMeetingDateYmd: string;
  closeType: string;
  meetingPlace: string;
}): boolean {
  if (!isMeetingScheduleSetCreatedStatus(item.estimateStatus)) return false;
  return (
    !item.firstMeetingDateYmd.trim() ||
    !item.closeType.trim() ||
    !item.meetingPlace.trim()
  );
}
