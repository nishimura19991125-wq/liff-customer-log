/** アポ情報一覧の1行。表示に必要な分だけ持つ軽量な型 */
export type ApoListRow = {
  recordId: string;
  /** 商談・資料送付予定日時の時刻（HH:mm。未設定時は空） */
  scheduledTime: string;
  customerName: string;
  /** 市区郡 */
  city: string;
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
