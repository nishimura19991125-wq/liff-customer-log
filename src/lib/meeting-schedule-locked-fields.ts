/**
 * LIFF から編集できない商談進捗の項目。
 *
 * 見積ステータスが誤タップでそのまま登録される事故があったため、
 * 見積ステータスと商談・資料送付予定日時は LIFF から変更できないようにした。
 * これらの変更は @pocket 側で直接行う。
 *
 * クライアント（入力欄を出すか）とサーバ（@pocket への payload に載せるか）が
 * **同じこの定義**を参照する。片方だけ塞いでも、古いキャッシュの画面や
 * API の直叩きで書き込めてしまうため。
 *
 * 元に戻すときは MEETING_SCHEDULE_LOCKED_FIELDS から外すだけでよい。
 * 入力欄の組み立てや保存判定のロジックは消さずに残してある。
 * ただし商談・資料送付予定日時を戻す場合は、日時更新に伴う見積ステータスの
 * 自動リセット（meeting-schedule.ts の scheduleDateChanged 周辺）と
 * その通知（autoEstimateStatus）も同時に有効化すること。
 */

export type MeetingScheduleLockedField = "estimateStatus" | "scheduledDateTime";

/** 現在 LIFF から変更できない項目 */
export const MEETING_SCHEDULE_LOCKED_FIELDS: readonly MeetingScheduleLockedField[] =
  ["estimateStatus", "scheduledDateTime"];

export const MEETING_SCHEDULE_LOCKED_FIELD_LABELS: Record<
  MeetingScheduleLockedField,
  string
> = {
  estimateStatus: "見積ステータス",
  scheduledDateTime: "商談・資料送付予定日時",
};

export function isMeetingScheduleFieldLocked(
  field: MeetingScheduleLockedField,
): boolean {
  return MEETING_SCHEDULE_LOCKED_FIELDS.includes(field);
}

/** 拒否をユーザーに伝える文言。画面にそのまま出る */
export function meetingScheduleLockedFieldMessage(
  field: MeetingScheduleLockedField,
): string {
  return `${MEETING_SCHEDULE_LOCKED_FIELD_LABELS[field]}は LIFF から変更できません。@pocket 側で変更してください`;
}

/**
 * @pocket へ送る payload から、編集不可な項目の列を落とす。
 *
 * お客様情報の decideApClStaffPut（AP/CL 担当者を payload から落とす実装）と
 * 同じ考え方。400 で弾かないのは、見積ステータスが**付随項目**
 * （初回商談実施日・片クロor両クロ・商談場所・返待ち回答日）と同じ
 * PATCH .../status ルートに同居しており、弾くと他項目の保存まで
 * 巻き込んで全滅させてしまうため。
 *
 * 落とした項目を返すので、呼び出し側でログに出せる。
 */
export function stripLockedMeetingScheduleFieldsFromPayload(
  payload: Record<string, unknown>,
  fieldIds: Partial<
    Record<MeetingScheduleLockedField, string | null | undefined>
  >,
): MeetingScheduleLockedField[] {
  const dropped: MeetingScheduleLockedField[] = [];

  for (const field of MEETING_SCHEDULE_LOCKED_FIELDS) {
    const fieldId = fieldIds[field];
    if (!fieldId) continue;
    if (!Object.prototype.hasOwnProperty.call(payload, fieldId)) continue;

    delete payload[fieldId];
    dropped.push(field);
  }

  return dropped;
}

/** 商談予定カードで、どの UI を出すかの判定 */
export type MeetingScheduleCardEditability = {
  /** 見積ステータスの選択欄を出すか */
  canEditStatus: boolean;
  /** 商談・資料送付予定日時の入力欄を出すか */
  canEditSchedule: boolean;
  /**
   * 付随項目（初回商談実施日・片クロor両クロ・商談場所・返待ち回答日）を
   * 編集できるか
   */
  canEditStatusDetails: boolean;
  /** 見積ステータスを値のテキストとして出すか */
  showStatusText: boolean;
  /** 商談・資料送付予定日時を値のテキストとして出すか */
  showScheduleText: boolean;
  /** 保存ボタンの行を出すか */
  showSaveBar: boolean;
};

/**
 * 商談予定カードの編集可否（純粋関数）。
 *
 * 付随項目の編集可否を canEditStatus にぶら下げないことがこの関数の要点。
 * 以前は showSetCreatedForm / showHenmachiForm / showSaveBar が
 * すべて canEditStatus 由来だったため、見積ステータスを編集不可にすると
 * 付随項目の入力欄も保存ボタンも道連れで消える構造だった。
 */
export function resolveMeetingScheduleCardEditability(input: {
  /** 見積ステータス側の書き込みが有効か（@pocket の API キー設定など） */
  statusEditable: boolean;
  /** 日時側の書き込みが有効か */
  scheduleEditable: boolean;
  /** 保存の口（onSave）があるか */
  savable: boolean;
  /** 見積ステータスの選択肢があるか */
  hasStatusOptions: boolean;
}): MeetingScheduleCardEditability {
  const statusContext = input.statusEditable && input.savable;
  const scheduleContext = input.scheduleEditable && input.savable;

  const canEditStatus =
    statusContext &&
    input.hasStatusOptions &&
    !isMeetingScheduleFieldLocked("estimateStatus");
  const canEditSchedule =
    scheduleContext && !isMeetingScheduleFieldLocked("scheduledDateTime");

  // 付随項目は見積ステータスと同じルートで保存するが、編集可否は別の軸
  const canEditStatusDetails = statusContext;

  return {
    canEditStatus,
    canEditSchedule,
    canEditStatusDetails,
    showStatusText: statusContext && !canEditStatus,
    showScheduleText: scheduleContext && !canEditSchedule,
    // 付随項目が編集できる限り保存ボタンは残す。
    // ここを canEditStatus || canEditSchedule にすると保存ボタンが消える
    showSaveBar: canEditStatusDetails || canEditSchedule,
  };
}
