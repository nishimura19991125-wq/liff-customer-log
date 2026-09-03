/**
 * カレンダー月ページ（liff-calendar-month-page.tsx）の画面ごとの設定。
 *
 * ⚠ コミュニケーションブリッジを削除したため、いまの利用者は工事
 *    カレンダーだけになった。ブリッジ側でしか使っていなかった項目
 *    （添付プレビュー・横並び・日付詳細の文言など）は**未使用のまま
 *    残している**。共用部品の分岐整理は別作業として切り出すため、
 *    ここでは型も分岐も畳まない（工事カレンダーの表示ロジックを
 *    書き換えるリスクを避ける）。
 */
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
  /** 日付詳細見出しの末尾（例: の◯◯）。現在は未使用 */
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
   * ⚠ コミュニケーションブリッジを削除したため、いまの利用者は工事
   *    カレンダーだけ。**分岐は残してある。** 「@pocket を開かせない」は
   *    業務判断で変わり得るので、true にするだけで戻せる形にしておく。
   */
  showCaseAccessLink?: boolean;
  /**
   * 案件カードから、アプリ内のお客様情報（契約情報入力フォーム）へ
   * 遷移できるようにするか。**既定は出さない。**
   *
   * 工事カレンダーでだけ true にしてある。@pocket の導線
   * （showCaseAccessLink）を閉じたのは「参照から編集につながる」ため
   * だが、こちらはアプリ側の編集経路なので方針と矛盾しない。
   *
   * ⚠ コミュニケーションブリッジを削除したため、いまの利用者は工事
   *    カレンダーだけ。既定（未指定＝出さない）は残してある。
   */
  showCustomerInfoLink?: boolean;
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
  // 代わりに、アプリ内のお客様情報（契約情報入力フォーム）へ飛べるようにする
  showCustomerInfoLink: true,
};
