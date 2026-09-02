import type { MeetingScheduleCardValues } from "@/lib/meeting-schedule-card-save";
import type { ApoListRow } from "@/lib/apo-list-types";

/**
 * アポ情報一覧の行を、商談ステータス編集の入力値へ直す。
 *
 * 編集の部品（useMeetingScheduleStatusForm / MeetingScheduleNegotiationFields）は
 * MeetingScheduleItem ではなく**この形**を受け取る。商談予定とアポ情報一覧の
 * どちらからも同じ形を作れるようにしてあり、判定も見た目も共有できる。
 *
 * 8項目はすべて段階Aで行に揃えてある（取得列は増やしていない）。
 * 名前が違うのは2つだけ。
 *   firstMeetingDateYmd → meetingDate
 *   responseDateYmd     → responseDate
 */
export function apoListRowToCardValues(
  row: ApoListRow,
): MeetingScheduleCardValues {
  return {
    estimateStatus: row.estimateStatus,
    scheduledYmd: row.scheduledYmd,
    scheduledTime: row.scheduledTime,
    meetingDate: row.firstMeetingDateYmd,
    closeType: row.closeType,
    meetingPlace: row.meetingPlace,
    responseDate: row.responseDateYmd,
    negotiationStatus: row.negotiationStatus,
  };
}
