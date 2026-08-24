import {
  isMeetingScheduleNegotiationWaitingStatus,
  isMeetingScheduleReNegotiationStatus,
} from "@/lib/meeting-schedule-shared";

/**
 * 商談ステータス（negotiationStatus）の編集。
 *
 * LIFF から選べるのは下記6件だけ。@pocket 側の実際の選択肢は14件あり、
 * これはその部分集合。設定を増やさない方針のため環境変数では可変にせず、
 * コードに固定する。
 *
 * クライアント（選択肢と確認ダイアログ）とサーバ（書き込みの検証）が
 * 同じこの定義を参照する。
 */
export const MEETING_SCHEDULE_NEGOTIATION_STATUS_OPTIONS: readonly string[] = [
  "商談待ち",
  "即決成約",
  "再商談",
  "返待ち",
  "否",
  "アポキャン",
];

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

/**
 * LIFF から選べる値なら正規化して返す。選べない値なら null。
 *
 * 現在値が6件の外（例: 資料送付成約）でも表示はできるが、
 * その値へ**変更**することはできない。
 */
export function normalizeSelectableNegotiationStatus(
  raw: string,
): string | null {
  const status = nfkc(raw);
  if (!status) return null;
  return (
    MEETING_SCHEDULE_NEGOTIATION_STATUS_OPTIONS.find(
      (o) => nfkc(o) === status,
    ) ?? null
  );
}

/**
 * 出勤後アラートに残る商談ステータスか。
 *
 * filterPendingMeetingAlerts が使っているのと**同じ判定関数**を組み合わせる。
 * 値のリストをこちらに書き写すと二重管理になり、
 * 片方だけ直したときに確認ダイアログの有無とアラートの実態がずれる。
 */
export function keepsMeetingScheduleAlert(negotiationStatusRaw: string): boolean {
  const status = negotiationStatusRaw.trim();
  return (
    isMeetingScheduleNegotiationWaitingStatus(status) ||
    isMeetingScheduleReNegotiationStatus(status)
  );
}

/**
 * 保存前に確認ダイアログを出すか。
 *
 * 基準は「出勤後アラートから消える値かどうか」。
 * 商談待ち・再商談はアラートに残るので出さない。
 * 即決成約・否・アポキャン・返待ちは消えるので出す。
 */
export function needsMeetingScheduleNegotiationConfirm(
  nextNegotiationStatus: string,
): boolean {
  if (!nextNegotiationStatus.trim()) return false;
  return !keepsMeetingScheduleAlert(nextNegotiationStatus);
}

/**
 * 確認ダイアログの本文。
 *
 * 「元に戻せません」とは書かない。実際は「商談待ち」に戻せる。
 */
export function meetingScheduleNegotiationConfirmMessage(
  nextNegotiationStatus: string,
): string {
  return `商談ステータスを「${nextNegotiationStatus.trim()}」に変更します。\nこの案件は出勤後の入力アラートに表示されなくなります。`;
}
