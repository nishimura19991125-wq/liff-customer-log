import {
  isMeetingScheduleHenmachiStatus,
  isMeetingScheduleSetCreatedStatus,
} from "@/lib/meeting-schedule-shared";
import { requiresMeetingScheduleResponseDate } from "@/lib/meeting-schedule-negotiation-status";

export type MeetingScheduleStatusUpdateInput = {
  status: string;
  meetingDate?: string | null;
  closeType?: string | null;
  meetingPlace?: string | null;
  responseDate?: string | null;
  /**
   * 商談ステータス。現在値と同じなら書き込まないため、
   * LIFF の選択肢6件の外の値がそのまま返ってくることもある。
   * 選択肢の検証は「変更されたとき」だけサーバ側で行う
   */
  negotiationStatus?: string | null;
};

function normalizeYmd(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const digits = s.replace(/[^\d]/g, "");
  if (digits.length >= 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  return "";
}

/**
 * 受け取った値の正規化と、項目の絞り込み。
 *
 * 注意：どの付随項目を受け取るかは、**クライアントが申告した status** を
 * 基準に絞っている。見積ステータス自体が LIFF から編集不可になり
 * @pocket へ書き込まれなくなった今、本来はレコードの実ステータスを基準に
 * するのが正しい（古い画面や API の直叩きが実態と違う status を申告すると、
 * 実ステータスに対応しない付随項目を書けてしまう）。
 * 実ステータス基準への変更はスコープ外で、別タスクとする。
 *
 * 必須の検証と「入力済みの項目は変更不可」の検証は、レコードの現在値が
 * 要るため updateMeetingScheduleStatusForStaff 側で行う。
 */
export function validateMeetingScheduleStatusUpdate(
  input: MeetingScheduleStatusUpdateInput,
): { ok: true; normalized: MeetingScheduleStatusUpdateInput } | { ok: false; error: string } {
  const status = input.status.trim();
  if (!status) {
    return { ok: false, error: "status が必要です" };
  }

  /**
   * ここでは正規化だけを行い、必須の検証はしない。
   *
   * 必須の基準は見積ステータスから**商談ステータス**へ移した。
   * さらに「@pocket の既存値 または 今回の新規入力」で埋まっているかを
   * 見る必要があり、レコードの現在値が要る。
   * そのため必須の検証は updateMeetingScheduleStatusForStaff 側で行う。
   *
   * どの項目を受け取るかの絞り込みは従来どおり残す。ただし
   * 見積ステータス＝商談セット作成済み かつ 商談ステータス＝返待ち で
   * 両方が同時に成立するため、排他分岐から積み上げに変えた。
   */
  const normalized: MeetingScheduleStatusUpdateInput = { status };

  if (isMeetingScheduleSetCreatedStatus(status)) {
    normalized.meetingDate = normalizeYmd(input.meetingDate);
    normalized.closeType = (input.closeType ?? "").trim();
    normalized.meetingPlace = (input.meetingPlace ?? "").trim();
    // 選択肢・遷移の検証はここでは行わない。現在値が遷移表の外
    // （例: 資料送付成約）のまま返ってくることがあり、ここで弾くと
    // 付随項目の保存まで巻き込む。実際に変更されたときだけ、
    // レコードの現在値と突き合わせられるサーバ側で検証する
    normalized.negotiationStatus = (input.negotiationStatus ?? "").trim();
  }

  if (
    isMeetingScheduleHenmachiStatus(status) ||
    requiresMeetingScheduleResponseDate((input.negotiationStatus ?? "").trim())
  ) {
    normalized.responseDate = normalizeYmd(input.responseDate);
  }

  return { ok: true, normalized };
}
