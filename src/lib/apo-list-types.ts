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
  /** 進行中の絞り込みに使う。表示はしない */
  negotiationStatus: string;
};

export type ApoListPayload = {
  configured: boolean;
  staffName: string;
  rows: ApoListRow[];
  error?: string;
};
