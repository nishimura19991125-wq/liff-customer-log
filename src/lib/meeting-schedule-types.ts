export type MeetingScheduleItem = {
  recordId: string;
  customerName: string;
  city: string;
  meetingTime: string;
  /** 商談予定時刻（HH:mm。未設定時は空） */
  scheduledTime: string;
  apoTypeLabel: string;
  estimateStatus: string;
  meetingPlace: string;
  /** 初回商談実施日（YYYY-MM-DD） */
  firstMeetingDateYmd: string;
  closeType: string;
  apPerson: string;
  clPerson: string;
  sortMinutes: number;
  /** 商談・資料送付予定日時など（一覧ソート用。未設定時は空） */
  scheduledYmd: string;
  /** 表示用日付ラベル（未設定時は「日付未定」） */
  scheduledDateLabel: string;
  /** Google マップ連携用 */
  pinpointAddress: string;
  normalAddress: string;
  /** 返待ち回答日（YYYY-MM-DD） */
  responseDateYmd: string;
  /** 表示用返待ち回答日ラベル（未設定時は「未設定」） */
  responseDateLabel: string;
};

export type MeetingScheduleAlertKind = "set-created" | "henmachi";

export type MeetingScheduleAlertItem = MeetingScheduleItem & {
  alertKind: MeetingScheduleAlertKind;
};

export type MeetingSchedulePayload = {
  configured: boolean;
  scope: "day" | "list";
  staffName: string;
  items: MeetingScheduleItem[];
  /** scope=day のときのみ */
  date?: string;
  dateLabel?: string;
  /** ステータス変更 UI 用 */
  statusOptions?: string[];
  statusEditable?: boolean;
  /** 商談・資料送付予定日時の変更 UI 用 */
  scheduleEditable?: boolean;
  closeTypeOptions?: string[];
  meetingPlaceOptions?: string[];
  error?: string;
};
