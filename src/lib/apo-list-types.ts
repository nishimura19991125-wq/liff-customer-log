/** アポ情報一覧の1行。表示に必要な分だけ持つ軽量な型 */
export type ApoListRow = {
  recordId: string;
  /**
   * 商談・資料送付予定日時の**日付だけ**（YYYY-MM-DD。未設定時は空）。
   *
   * 初回商談実施日で埋めない。日付グルーピングの基準にも使う
   */
  scheduledYmd: string;
  /** 商談・資料送付予定日時の時刻（HH:mm。未設定時は空） */
  scheduledTime: string;
  /** 日付見出し（「6月12日（金）」など）。未設定時は「日付未定」 */
  scheduledDateLabel: string;
  customerName: string;
  /** 市区郡 */
  city: string;
  /** アポ種別（DC案件・SP案件など） */
  apoTypeLabel: string;
  estimateStatus: string;
  /** ギフト券（有/無）。「有」のときだけバッジを出す */
  giftCoupon: string;
  /** 進行中の絞り込みに使う。表示はしない */
  negotiationStatus: string;
  /**
   * Dropbox フォルダの URL。**https のみ**（サーバ側で safeHttpsUrl を通す）。
   * 未設定・不正な値はどちらも空文字になり、画面では「未設定」と出す
   */
  dropboxUrl: string;
  /**
   * ここから4つは商談ステータスの編集（段階 C）で使う付随項目。
   *
   * ⚠ **取得列は増えていない。** 4つとも meetingScheduleWantedFieldCsv に
   *    元から入っており、buildApoListRow が読んでいなかっただけ。
   *    キャッシュキーは変わらず、@pocket の呼び出しも増えない。
   *
   * 読み方は商談予定（MeetingScheduleItem）と同じ関数を使う。
   */
  /** 初回商談実施日（YYYY-MM-DD。未設定時は空） */
  firstMeetingDateYmd: string;
  /** 片クロor両クロ */
  closeType: string;
  /** 商談場所 */
  meetingPlace: string;
  /** 返待ち回答日（YYYY-MM-DD。未設定時は空） */
  responseDateYmd: string;
};

export type ApoListPayload = {
  configured: boolean;
  staffName: string;
  rows: ApoListRow[];
  /**
   * ここから4つは商談ステータスの編集（段階 C）で使う。
   * すべて環境変数から作る純粋関数の結果で、**@pocket は叩かない**。
   * 商談予定と同じ meetingScheduleMetaExtras() から取るので、
   * 画面ごとに選択肢がずれることがない。
   *
   * ⚠ statusOptions は**見積ステータス**の選択肢。商談ステータスの
   *    選択肢は現在値から導く（meetingScheduleNegotiationOptionsFor）
   *    ので、ペイロードには持たない。
   */
  statusOptions?: string[];
  /** 見積ステータス・付随項目を編集できるか（書き込み用APIキーの有無） */
  statusEditable?: boolean;
  closeTypeOptions?: string[];
  meetingPlaceOptions?: string[];
  error?: string;
};
