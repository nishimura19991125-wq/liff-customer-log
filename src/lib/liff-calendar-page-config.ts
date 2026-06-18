export type LiffCalendarPageConfig = {
  title: string;
  description: string;
  calendarApiPath: string;
  disabledFallbackMessage: string;
  enableNewRecordPanel: boolean;
  enableEmptySlotFill: boolean;
  /** 添付画像を空枠の代わりに表示 */
  showAttachmentPreviews?: boolean;
  attachmentApiPath?: string;
  /** 空枠セクション見出し（未指定時は「工事空枠」） */
  emptySlotSectionLabel?: string;
  /** 月マスに空枠用の点線枠を付ける */
  showEmptySlotGridStyle?: boolean;
  /** 「工事空枠」「空枠」などの表記を表示する（工事カレンダー向け） */
  showEmptySlotNotation?: boolean;
  /** 月マス内のバッジ（新・既・空枠・画像など）を表示する */
  showDayCellBadges?: boolean;
  /** 日付詳細見出しの末尾（例: のコミュニケーションブリッジ） */
  dayDetailHeadingSuffix?: string;
  /** 日付詳細が空のときのメッセージ */
  dayDetailEmptyMessage?: string;
  /** PC 幅でカレンダーと日付詳細を横並びにする */
  desktopSideBySideLayout?: boolean;
  /** 添付画像を画面内に収めて全体表示する */
  fitAttachmentToViewport?: boolean;
  /** 選択中の日付をカレンダー上で強調表示する */
  emphasizeSelectedDay?: boolean;
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
  showEmptySlotGridStyle: true,
};

export const COMMUNICATION_BRIDGE_CALENDAR_PAGE_CONFIG: LiffCalendarPageConfig =
  {
    title: "コミュニケーションブリッジ",
    description:
      "日付をタップで下に一覧表示します。添付画像をタップして拡大表示できます。",
    calendarApiPath: "/api/communication-bridge/calendar",
    disabledFallbackMessage:
      "コミュニケーションブリッジは環境変数の設定後に利用できます。",
    enableNewRecordPanel: false,
    enableEmptySlotFill: false,
    showAttachmentPreviews: true,
    attachmentApiPath: "/api/communication-bridge/attachment",
    showEmptySlotGridStyle: false,
    showEmptySlotNotation: false,
    showDayCellBadges: false,
    dayDetailHeadingSuffix: "のコミュニケーションブリッジ",
    dayDetailEmptyMessage: "この日のコミュニケーションブリッジはありません",
    desktopSideBySideLayout: true,
    fitAttachmentToViewport: true,
    emphasizeSelectedDay: true,
  };
