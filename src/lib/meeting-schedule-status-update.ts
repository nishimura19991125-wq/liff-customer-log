import {
  isMeetingScheduleHenmachiStatus,
  isMeetingScheduleSetCreatedStatus,
} from "@/lib/meeting-schedule-shared";

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
 * 見積ステータスと付随項目の検証。
 *
 * 注意：どの付随項目を必須とするかは、**クライアントが申告した status** を
 * 基準に判定している。見積ステータス自体が LIFF から編集不可になり
 * @pocket へ書き込まれなくなった今、本来はレコードの実ステータスを基準に
 * 判定するのが正しい（古い画面や API の直叩きが実態と違う status を申告すると、
 * 実ステータスに対応しない付随項目を書けてしまう）。
 * 実ステータス基準への変更は今回のスコープ外で、別タスクとする。
 */
export function validateMeetingScheduleStatusUpdate(
  input: MeetingScheduleStatusUpdateInput,
): { ok: true; normalized: MeetingScheduleStatusUpdateInput } | { ok: false; error: string } {
  const status = input.status.trim();
  if (!status) {
    return { ok: false, error: "status が必要です" };
  }

  if (isMeetingScheduleSetCreatedStatus(status)) {
    const meetingDate = normalizeYmd(input.meetingDate);
    const closeType = (input.closeType ?? "").trim();
    const meetingPlace = (input.meetingPlace ?? "").trim();

    if (!meetingDate) {
      return { ok: false, error: "初回商談実施日を入力してください" };
    }
    if (!closeType) {
      return { ok: false, error: "片クロor両クロを選択してください" };
    }
    if (!meetingPlace) {
      return { ok: false, error: "商談場所を選択してください" };
    }

    return {
      ok: true,
      normalized: {
        status,
        meetingDate,
        closeType,
        meetingPlace,
        // 選択肢の検証はここでは行わない。現在値が LIFF の選択肢6件の
        // 外（例: 資料送付成約）のまま返ってくることがあり、ここで弾くと
        // 付随項目の保存まで巻き込む。実際に変更されたときだけ、
        // レコードの現在値と突き合わせられるサーバ側で検証する
        negotiationStatus: (input.negotiationStatus ?? "").trim(),
      },
    };
  }

  if (isMeetingScheduleHenmachiStatus(status)) {
    const responseDate = normalizeYmd(input.responseDate);
    if (!responseDate) {
      return { ok: false, error: "返待ち回答日を入力してください" };
    }
    return {
      ok: true,
      normalized: {
        status,
        responseDate,
      },
    };
  }

  return {
    ok: true,
    normalized: { status },
  };
}
