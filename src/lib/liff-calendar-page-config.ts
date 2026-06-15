export type LiffCalendarPageConfig = {
  title: string;
  description: string;
  calendarApiPath: string;
  disabledFallbackMessage: string;
  enableNewRecordPanel: boolean;
  enableEmptySlotFill: boolean;
  showNewsMarquee: boolean;
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
};

export const COMMUNICATION_BRIDGE_CALENDAR_PAGE_CONFIG: LiffCalendarPageConfig =
  {
    title: "コミュニケーションブリッジカレンダー",
    description:
      "日付をタップで下に一覧表示します。案件はタップして @pocket を開けます。",
    calendarApiPath: "/api/communication-bridge/calendar",
    disabledFallbackMessage:
      "コミュニケーションブリッジカレンダーは環境変数の設定後に利用できます。",
    enableNewRecordPanel: false,
    enableEmptySlotFill: false,
    showNewsMarquee: false,
  };
