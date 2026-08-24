import {
  isMeetingScheduleNegotiationWaitingStatus,
  isMeetingScheduleReNegotiationStatus,
} from "@/lib/meeting-schedule-shared";

/**
 * 商談ステータス（negotiationStatus）の遷移ルール。
 *
 * 選べる値は現在値によって変わる。キーが @pocket 側の選択肢14件で全て、
 * 値がそこから選べる遷移先。**現在値そのものを先頭に含める**ので、
 * 「変更しない」という選択ができる。
 *
 * 遷移先が空の9件は変更不可。画面では選択欄を出さず値をテキスト表示にする。
 * 変更不可のリストを別に持つと二重管理になるため、「遷移先が空かどうか」
 * だけで表現する。
 *
 * クライアント（選択肢と確認ダイアログ）とサーバ（書き込みの検証）が
 * 同じこの定義を参照する。設定を増やさない方針のため環境変数では
 * 可変にせず、コードに固定する。
 */
export const MEETING_SCHEDULE_NEGOTIATION_TRANSITIONS: Readonly<
  Record<string, readonly string[]>
> = {
  商談待ち: ["商談待ち", "即決成約", "再商談", "返待ち", "否", "アポキャン"],
  再商談: ["再商談", "再商談成約", "再商談否", "再商談日調整中", "返待ち"],
  返待ち: ["返待ち", "返待ち成約", "返待ち否", "再商談"],
  資料送付回答待ち: ["資料送付回答待ち", "資料送付成約", "資料送付否", "再商談"],
  再商談日調整中: ["再商談日調整中", "再商談", "再商談成約", "再商談否", "返待ち"],

  // ここから下は変更不可（遷移先が空）
  即決成約: [],
  再商談成約: [],
  返待ち成約: [],
  否: [],
  再商談否: [],
  返待ち否: [],
  アポキャン: [],
  資料送付成約: [],
  資料送付否: [],
};

/** @pocket 側の商談ステータス選択肢。遷移表のキーがそのまま全件 */
export const MEETING_SCHEDULE_NEGOTIATION_STATUSES: readonly string[] =
  Object.keys(MEETING_SCHEDULE_NEGOTIATION_TRANSITIONS);

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

/**
 * 遷移表に載っている値なら正規化して返す。載っていなければ null。
 *
 * @pocket の値には全角・前後の空白のゆれがあり得るので、
 * 突き合わせは正規化してから行う。
 */
export function normalizeMeetingScheduleNegotiationStatus(
  raw: string,
): string | null {
  const status = nfkc(raw);
  if (!status) return null;
  return (
    MEETING_SCHEDULE_NEGOTIATION_STATUSES.find((s) => nfkc(s) === status) ?? null
  );
}

/**
 * 現在値から選べる商談ステータス。現在値が先頭に入る。
 *
 * 遷移表に無い値（@pocket 側で選択肢が増えた・空欄など）は空配列を返す。
 * 呼び出し側は「選択欄を出さずテキスト表示にする」で扱う
 */
export function meetingScheduleNegotiationOptionsFor(
  currentRaw: string,
): string[] {
  const current = normalizeMeetingScheduleNegotiationStatus(currentRaw);
  if (!current) return [];
  return [...MEETING_SCHEDULE_NEGOTIATION_TRANSITIONS[current]];
}

/** 現在値から商談ステータスを変更できるか。遷移先が空なら変更不可 */
export function canEditMeetingScheduleNegotiationStatus(
  currentRaw: string,
): boolean {
  return meetingScheduleNegotiationOptionsFor(currentRaw).length > 0;
}

/** 現在値から変更後の値へ遷移できるか。サーバ側の検証にも使う */
export function canTransitionMeetingScheduleNegotiationStatus(
  currentRaw: string,
  nextRaw: string,
): boolean {
  const next = normalizeMeetingScheduleNegotiationStatus(nextRaw);
  if (!next) return false;
  return meetingScheduleNegotiationOptionsFor(currentRaw).includes(next);
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
 * 実際に値が変わるときだけ、かつ変更後の値でアラートから消えるときに出す。
 * 現在値のまま保存する場合は何も変わらないので出さない。
 */
export function needsMeetingScheduleNegotiationConfirm(
  currentRaw: string,
  nextRaw: string,
): boolean {
  const next = nfkc(nextRaw);
  if (!next) return false;
  if (next === nfkc(currentRaw)) return false;
  return !keepsMeetingScheduleAlert(next);
}

/**
 * 確認ダイアログの本文。
 *
 * 「元に戻せません」とは書かない。実際は戻せる遷移もある。
 */
export function meetingScheduleNegotiationConfirmMessage(
  nextNegotiationStatus: string,
): string {
  return `商談ステータスを「${nextNegotiationStatus.trim()}」に変更します。\nこの案件は出勤後の入力アラートに表示されなくなります。`;
}
