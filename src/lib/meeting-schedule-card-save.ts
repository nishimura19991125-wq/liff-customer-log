import {
  isMeetingScheduleHenmachiStatus,
  isMeetingScheduleSetCreatedStatus,
} from "@/lib/meeting-schedule-shared";
import type { MeetingScheduleScheduledUpdateInput } from "@/lib/meeting-schedule-scheduled-update";
import type { MeetingScheduleStatusUpdateInput } from "@/lib/meeting-schedule-status-update";

/**
 * 商談進捗カードの「保存」の判定（純粋関数）。
 *
 * 以前は見積ステータスのプルダウンを変更した時点で PATCH していたため、
 * 誤タップがそのまま @pocket へ登録されていた。画面の状態と @pocket の値を
 * 突き合わせ、**変更があったものだけ**を保存対象にする。
 *
 * 既存の API は 2 本のまま使う。
 *   PATCH /api/meeting-schedule/records/[recordId]/status
 *   PATCH /api/meeting-schedule/records/[recordId]/schedule
 */

/** 画面側の入力値と @pocket 側の現在値を同じ形で持つ */
export type MeetingScheduleCardValues = {
  estimateStatus: string;
  scheduledYmd: string;
  scheduledTime: string;
  meetingDate: string;
  closeType: string;
  meetingPlace: string;
  responseDate: string;
  /**
   * 商談ステータス。「商談セット作成済みの入力項目」の枠内で編集する。
   * 現在値が LIFF の選択肢6件の外（例: 資料送付成約）のこともある
   */
  negotiationStatus: string;
};

export type MeetingScheduleCardPatch = {
  status?: MeetingScheduleStatusUpdateInput;
  schedule?: MeetingScheduleScheduledUpdateInput;
};

export type MeetingScheduleCardSavePlan = {
  /** 見積ステータス（および付随項目）に変更があるか */
  statusDirty: boolean;
  /** 商談・資料送付予定日時に変更があるか */
  scheduleDirty: boolean;
  /** どちらかに変更があるか。「未保存の変更があります」の表示条件 */
  dirty: boolean;
  /** 変更はあるが必須項目が欠けている理由。空なら保存できる */
  blockedReason: string;
  /** 実際に送る内容。blockedReason があるときは空 */
  patch: MeetingScheduleCardPatch;
};

export type MeetingScheduleCardSaveOptions = {
  /** 見積ステータスそのものを変更できるか */
  statusEditable: boolean;
  /**
   * 付随項目（初回商談実施日・片クロor両クロ・商談場所・返待ち回答日）を
   * 変更できるか。省略時は statusEditable に従う。
   *
   * 見積ステータスと同じルートで保存するが、編集可否は別の軸。
   * statusEditable にぶら下げたままだと、見積ステータスを編集不可にした瞬間に
   * 付随項目の変更まで保存対象から外れ、保存ボタンが永久に押せなくなる
   */
  statusDetailsEditable?: boolean;
  /** 商談・資料送付予定日時を変更できるか */
  scheduleEditable: boolean;
};

export function planMeetingScheduleCardSave(
  server: MeetingScheduleCardValues,
  draft: MeetingScheduleCardValues,
  opts: MeetingScheduleCardSaveOptions,
): MeetingScheduleCardSavePlan {
  const statusDetailsEditable =
    opts.statusDetailsEditable ?? opts.statusEditable;

  // 付随項目の要否は「選び直した後の」ステータスで決まる。
  // 見積ステータスが編集不可のあいだ draft.estimateStatus は常に
  // server.estimateStatus と同じ値なので、実質「現在のステータス」で決まる
  const needsSetCreated = isMeetingScheduleSetCreatedStatus(draft.estimateStatus);
  const needsHenmachi = isMeetingScheduleHenmachiStatus(draft.estimateStatus);

  const statusChanged =
    opts.statusEditable && draft.estimateStatus !== server.estimateStatus;

  // ステータスを変えずに付随項目だけ直す場合も status 側の保存対象にする
  const setCreatedChanged =
    statusDetailsEditable &&
    needsSetCreated &&
    (draft.meetingDate !== server.meetingDate ||
      draft.closeType !== server.closeType ||
      draft.meetingPlace !== server.meetingPlace ||
      draft.negotiationStatus !== server.negotiationStatus);

  const henmachiChanged =
    statusDetailsEditable &&
    needsHenmachi &&
    draft.responseDate !== server.responseDate;

  const statusDirty = statusChanged || setCreatedChanged || henmachiChanged;
  const scheduleDirty =
    opts.scheduleEditable &&
    (draft.scheduledYmd !== server.scheduledYmd ||
      draft.scheduledTime !== server.scheduledTime);

  // サーバ側（validateMeetingScheduleStatusUpdate）と同じ必須条件を先に見て、
  // 400 が返ることが分かっている送信をボタンの時点で止める
  let blockedReason = "";
  if (scheduleDirty && !draft.scheduledYmd.trim()) {
    blockedReason = "日付を入力すると保存できます";
  } else if (statusDirty) {
    // 見積ステータスが編集不可のときは、この必須チェックを行わない。
    // 画面に選択欄が無く選び直しようがないため、ここで止めると
    // 付随項目だけの保存を永久にブロックしてしまう
    if (opts.statusEditable && !draft.estimateStatus.trim()) {
      blockedReason = "見積ステータスを選ぶと保存できます";
    } else if (needsSetCreated) {
      if (!draft.meetingDate.trim()) {
        blockedReason = "初回商談実施日を入力すると保存できます";
      } else if (!draft.closeType.trim()) {
        blockedReason = "片クロor両クロを選ぶと保存できます";
      } else if (!draft.meetingPlace.trim()) {
        blockedReason = "商談場所を選ぶと保存できます";
      }
    } else if (needsHenmachi && !draft.responseDate.trim()) {
      blockedReason = "返待ち回答日を入力すると保存できます";
    }
  }

  const patch: MeetingScheduleCardPatch = {};
  if (!blockedReason) {
    if (scheduleDirty) {
      patch.schedule = {
        scheduledYmd: draft.scheduledYmd,
        scheduledTime: draft.scheduledTime,
      };
    }
    if (statusDirty) {
      // status は PATCH .../status の必須項目なので、見積ステータスが
      // 編集不可でも現在値をそのまま載せる。サーバ側は受け取った status を
      // 付随項目の必須判定にだけ使い、@pocket へは書き込まない
      patch.status = needsSetCreated
        ? {
            status: draft.estimateStatus,
            meetingDate: draft.meetingDate,
            closeType: draft.closeType,
            meetingPlace: draft.meetingPlace,
            // 現在値のまま送られることもある。サーバ側は現在値と同じなら
            // 書き込まないので、6件の外の値でも弾かれない
            negotiationStatus: draft.negotiationStatus,
          }
        : needsHenmachi
          ? { status: draft.estimateStatus, responseDate: draft.responseDate }
          : { status: draft.estimateStatus };
    }
  }

  return {
    statusDirty,
    scheduleDirty,
    dirty: statusDirty || scheduleDirty,
    blockedReason,
    patch,
  };
}
