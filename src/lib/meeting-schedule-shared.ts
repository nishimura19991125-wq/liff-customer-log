export const MEETING_SCHEDULE_SET_CREATED_STATUS = "商談セット作成済み";
export const MEETING_SCHEDULE_HENMACHI_STATUS = "返待ち";
export const MEETING_SCHEDULE_ESTIMATE_REQUESTED_STATUS = "見積依頼済み";
export const MEETING_SCHEDULE_NEGOTIATION_WAITING_STATUS = "商談待ち";
export const MEETING_SCHEDULE_NEGOTIATION_RE_STATUS = "再商談";

export function isMeetingScheduleSetCreatedStatus(statusRaw: string): boolean {
  return statusRaw
    .normalize("NFKC")
    .trim()
    .includes(MEETING_SCHEDULE_SET_CREATED_STATUS);
}

export function isMeetingScheduleNegotiationWaitingStatus(
  statusRaw: string,
): boolean {
  return statusRaw
    .normalize("NFKC")
    .trim()
    .includes(MEETING_SCHEDULE_NEGOTIATION_WAITING_STATUS);
}

export function isMeetingScheduleReNegotiationStatus(statusRaw: string): boolean {
  const status = statusRaw.normalize("NFKC").trim();
  if (!status.includes(MEETING_SCHEDULE_NEGOTIATION_RE_STATUS)) return false;
  if (status.includes("再商談否") || status.includes("再商談成約")) return false;
  return true;
}

export function isMeetingScheduleHenmachiStatus(statusRaw: string): boolean {
  const status = statusRaw.normalize("NFKC").trim();
  if (!status.includes(MEETING_SCHEDULE_HENMACHI_STATUS)) return false;
  if (status.includes("返待ち否") || status.includes("返待ち成約")) return false;
  return true;
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

export function needsMeetingScheduleHenmachiAlert(
  item: {
    estimateStatus: string;
    responseDateYmd: string;
  },
  todayYmd: string,
): boolean {
  if (!isMeetingScheduleHenmachiStatus(item.estimateStatus)) return false;
  const responseYmd = item.responseDateYmd.trim();
  if (!responseYmd) return true;
  return responseYmd < todayYmd;
}

export function isScheduledBeforeToday(
  scheduledYmd: string,
  todayYmd: string,
): boolean {
  const ymd = scheduledYmd.trim();
  if (!ymd) return true;
  return ymd < todayYmd;
}
