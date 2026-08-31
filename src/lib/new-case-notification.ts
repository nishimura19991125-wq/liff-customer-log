/**
 * 新規案件通知の本文を組み立てる純粋関数。
 *
 * 送信そのものは new-case-notification-server.ts、Webhook は google-chat.ts。
 * ここは文字列を作るだけで、環境変数も @pocket も触らない。
 *
 * 値が空でも**行は残す**（契約速報＝タスクR と同じ扱い）。行ごと消すと、
 * 何が埋まらなかったのか受け取り側に伝わらない。
 */

/**
 * 見出しの後ろの余白は**依頼どおりの並び**。
 *
 * Google Chat は等幅ではないので桁は揃わないが、運用側が決めた見た目を
 * 変えない。整形し直したくなっても、依頼が変わるまで触らないこと。
 */
const LABEL_T_NUMBER = "T番号　 　 ";
const LABEL_CUSTOMER_NAME = "お客様名　 ";
const LABEL_CREATOR = "案件作成者";

/** 本文の1行目。前後の絵文字まで含めて固定 */
export const NEW_CASE_NOTIFICATION_HEADING = "🐣新規案件が追加されました🐣";

export type NewCaseNotificationInput = {
  /** お客様情報アプリが採番した T番号 */
  tNumber: string;
  /** 工事カレンダーの新規登録で入力されたお客様名 */
  customerName: string;
  /** 操作した人（LIFF でログインしているスタッフの担当者名） */
  creatorName: string;
};

/** @pocket の「未入力」表現（"-"）は通知に出さない */
function plain(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  return t === "-" ? "" : t;
}

export function buildNewCaseNotificationText(
  input: NewCaseNotificationInput,
): string {
  return [
    NEW_CASE_NOTIFICATION_HEADING,
    "",
    `${LABEL_T_NUMBER}：${plain(input.tNumber)}`,
    `${LABEL_CUSTOMER_NAME}：${plain(input.customerName)}`,
    `${LABEL_CREATOR}：${plain(input.creatorName)}`,
  ].join("\n");
}
