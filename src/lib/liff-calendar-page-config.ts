export type LiffCalendarPageConfig = {
  title: string;
  description: string;
  calendarApiPath: string;
  disabledFallbackMessage: string;
  enableNewRecordPanel: boolean;
  enableEmptySlotFill: boolean;
  showNewsMarquee: boolean;
  /** 添付画像を空枠の代わりに表示 */
  showAttachmentPreviews?: boolean;
  attachmentApiPath?: string;
  /** 空枠セクション見出し（未指定時は「工事空枠」） */
  emptySlotSectionLabel?: string;
  /** 月マスに空枠用の点線枠を付ける */
  showEmptySlotGridStyle?: boolean;
};

export const CONSTRUCTION_CALENDAR_PAGE_CONFIG: LiffCalendarPageConfig = {
  title: "工事カレンダー",
  description:
    "日付をタップで下に一覧表示。工事空枠は「情報を入力」からお客様名を登録できます。案件は @pocket を開けます。",
  calendarApiPath: "/api/calendar",
  disabledFallbackMessage:
    "工事カレンダーは環境変数 CALENDAR_APP_ID 設定後に利用できます。",
  enableNewRecordPanel: true,
  enableEmptySlotFill: true,
  showNewsMarquee: true,
  showEmptySlotGridStyle: true,
};

export const COMMUNICATION_BRIDGE_CALENDAR_PAGE_CONFIG: LiffCalendarPageConfig =
  {
    title: "コミュニケーションブリッジカレンダー",
    description:
      "日付をタップで下に一覧表示します。添付画像をタップして拡大表示できます。",
    calendarApiPath: "/api/communication-bridge/calendar",
    disabledFallbackMessage:
      "コミュニケーションブリッジカレンダーは環境変数の設定後に利用できます。",
    enableNewRecordPanel: false,
    enableEmptySlotFill: false,
    showNewsMarquee: false,
    showAttachmentPreviews: true,
    attachmentApiPath: "/api/communication-bridge/attachment",
    emptySlotSectionLabel: "スケジュール",
    showEmptySlotGridStyle: false,
  };
