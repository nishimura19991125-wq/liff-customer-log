import {
  isMeetingScheduleHenmachiStatus,
  isMeetingScheduleSetCreatedStatus,
} from "@/lib/meeting-schedule-shared";
import {
  findMissingMeetingScheduleRequiredInput,
  showsMeetingScheduleHenmachiForm,
  showsMeetingScheduleInputFields,
  MEETING_SCHEDULE_INPUT_BLOCKED_HINTS,
} from "@/lib/meeting-schedule-negotiation-status";
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

  /**
   * 付随項目4つを画面に出しているか。アポキャンだけ false。
   *
   * 出していない項目は保存対象にしない。入力途中でアポキャンに変えると
   * 画面から消えるが、消えた値がそのまま送られると
   * 「画面に出ていないのに書き込まれた」ことになるため。
   *
   * 送らない＝消す、ではない。サーバ側は空の項目を書き込み対象から外す
   * （meeting-schedule.ts の「if (!incoming) continue;」）ので、
   * @pocket の既存値はそのまま残る。
   */
  const showsInputFields = showsMeetingScheduleInputFields(
    draft.negotiationStatus,
  );

  // ステータスを変えずに付随項目だけ直す場合も status 側の保存対象にする
  const setCreatedChanged =
    statusDetailsEditable &&
    needsSetCreated &&
    ((showsInputFields &&
      (draft.meetingDate !== server.meetingDate ||
        draft.closeType !== server.closeType ||
        draft.meetingPlace !== server.meetingPlace)) ||
      // 商談ステータス自体は付随項目を出していなくても保存できる
      // （商談待ち → アポキャン がこの経路）
      draft.negotiationStatus !== server.negotiationStatus);

  /**
   * 返待ち回答日を保存対象に含めるか。
   *
   * 見積ステータスが「返待ち」のときに加えて、商談ステータスが「返待ち」の
   * ときも含める。必須の基準を商談ステータスへ移したため、こちらも広げないと
   * 「必須なのに送る経路が無い」状態になり保存が永久にできなくなる。
   * 画面の入力枠の表示条件（showsMeetingScheduleHenmachiForm）と対にする
   */
  const includesResponseDate = showsMeetingScheduleHenmachiForm({
    estimateStatusIsHenmachi: needsHenmachi,
    negotiationStatus: draft.negotiationStatus,
  });

  const henmachiChanged =
    statusDetailsEditable &&
    includesResponseDate &&
    draft.responseDate !== server.responseDate;

  const statusDirty = statusChanged || setCreatedChanged || henmachiChanged;
  const scheduleDirty =
    opts.scheduleEditable &&
    (draft.scheduledYmd !== server.scheduledYmd ||
      draft.scheduledTime !== server.scheduledTime);

  // サーバ側と同じ必須条件を先に見て、
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
    } else {
      /**
       * 必須の判定は**商談ステータス基準**。
       * 以前は見積ステータスが「商談セット作成済み」なら3項目を常に必須に
       * していたが、対象項目が空のまま残っている既存案件が編集不能になる。
       * 判定は meeting-schedule-negotiation-status.ts に寄せてある
       */
      const missing = findMissingMeetingScheduleRequiredInput({
        server: {
          meetingDate: server.meetingDate,
          closeType: server.closeType,
          meetingPlace: server.meetingPlace,
          responseDate: server.responseDate,
        },
        draft: {
          meetingDate: draft.meetingDate,
          closeType: draft.closeType,
          meetingPlace: draft.meetingPlace,
          responseDate: draft.responseDate,
        },
        serverNegotiationStatus: server.negotiationStatus,
        draftNegotiationStatus: draft.negotiationStatus,
      });
      blockedReason = missing ? MEETING_SCHEDULE_INPUT_BLOCKED_HINTS[missing] : "";
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
      /**
       * status は PATCH .../status の必須項目なので、見積ステータスが
       * 編集不可でも現在値をそのまま載せる。サーバ側は受け取った status を
       * 付随項目の必須判定にだけ使い、@pocket へは書き込まない。
       *
       * 以前は「商談セット作成済み」と「返待ち」の排他分岐だったが、
       * 見積ステータス＝商談セット作成済み かつ 商談ステータス＝返待ち で
       * 両方が同時に成立するようになったため、積み上げる形に変えた。
       * 排他のままだと返待ち回答日が patch に載らず、必須なのに送れない
       */
      const status: MeetingScheduleStatusUpdateInput = {
        status: draft.estimateStatus,
      };
      if (needsSetCreated) {
        // 画面に出していない項目は載せない（アポキャン）。
        // 載せないだけで、@pocket の既存値は消えない
        if (showsInputFields) {
          status.meetingDate = draft.meetingDate;
          status.closeType = draft.closeType;
          status.meetingPlace = draft.meetingPlace;
        }
        // 現在値のまま送られることもある。サーバ側は現在値と同じなら
        // 書き込まないので、遷移表の外の値でも弾かれない
        status.negotiationStatus = draft.negotiationStatus;
      }
      if (includesResponseDate) {
        status.responseDate = draft.responseDate;
      }
      patch.status = status;
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
