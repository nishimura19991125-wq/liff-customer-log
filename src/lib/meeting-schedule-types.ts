export type MeetingScheduleItem = {
  recordId: string;
  customerName: string;
  city: string;
  meetingTime: string;
  apoTypeLabel: string;
  estimateStatus: string;
  meetingPlace: string;
  apPerson: string;
  clPerson: string;
  sortMinutes: number;
  /** 商談・資料送付予定日時など（一覧ソート用。未設定時は空） */
  scheduledYmd: string;
  /** 表示用日付ラベル（未設定時は「日付未定」） */
  scheduledDateLabel: string;
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
  error?: string;
};
