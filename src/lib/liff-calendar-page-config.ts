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
  /**
   * 案件カードをタップして @pocket を開けるようにするか。**既定は開ける。**
   *
   * 工事カレンダーでは false にしてある。管理者以外は @pocket 側で編集
   * できない設定になっているが、導線があると参照から編集につながる。
   * アプリ側（工事日を変更・工事対応者の変更）で操作してもらう。
   *
   * ⚠ この画面部品はコミュニケーションブリッジと共用している。あちらは
   *    別の画面なので既定のまま（開ける）。閉じるなら false を足すだけ。
   */
  showCaseAccessLink?: boolean;
};

export const CONSTRUCTION_CALENDAR_PAGE_CONFIG: LiffCalendarPageConfig = {
  title: "工事カレンダー",
  description:
    "日付をタップで下に一覧表示。工事空枠は「情報を入力」からお客様名を登録できます。",
  calendarApiPath: "/api/calendar",
  disabledFallbackMessage:
    "工事カレンダーは環境変数 CALENDAR_APP_ID 設定後に利用できます。",
  enableNewRecordPanel: true,
  enableEmptySlotFill: true,
  showEmptySlotGridStyle: true,
  // 案件カードから @pocket を開かせない（アプリ側で操作してもらう）
  showCaseAccessLink: false,
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
