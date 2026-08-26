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

/**
 * 出勤後アラートの日付条件。
 *
 * 商談・資料送付予定日時の**日付が今日より前**なら true。
 *   - 見るのは日付だけ。時刻は見ない
 *   - 今日の案件は出さない（今日 14:00 の案件は時刻を過ぎていても対象外）
 *   - 空欄は出さない
 *
 * 「今日」は引数で受け取る。呼び出し側が Asia/Tokyo 基準の値を渡す。
 *
 * 似た名前の isScheduledBeforeToday とは**空欄の扱いが逆**（あちらは
 * 空欄を true にする）。アラートの判定にはこちらを使うこと。
 */
export function isMeetingScheduleAlertOverdue(
  scheduledDateTimeYmdRaw: string,
  todayYmd: string,
): boolean {
  const scheduled = normalizeMeetingScheduleYmd(scheduledDateTimeYmdRaw);
  if (!scheduled) return false;

  const today = normalizeMeetingScheduleYmd(todayYmd);
  if (!today) return false;

  // YYYY-MM-DD 同士なら辞書順の比較がそのまま日付の前後になる
  return scheduled < today;
}

/**
 * 日付を YYYY-MM-DD に揃える。
 *
 * @pocket の値には「2026/09/10 00:00:00」のような形式が混ざるため、
 * 比較の前に揃える。サーバ側で揃えた値が渡ってくる前提だが、
 * 取り違えても誤判定しないようここでも受ける
 */
function normalizeMeetingScheduleYmd(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";

  const datePart =
    s.replace(/\//g, "-").split("T")[0]?.split(" ")[0]?.trim() ?? "";
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(datePart);
  if (!m) return "";

  return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
}
