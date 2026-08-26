import { formatDisplayYmd } from "@/lib/format-display-ymd";
import { groupItemsByDate, type DateGroup } from "@/lib/meeting-schedule-list-groups";
import type { ApoListRow } from "@/lib/apo-list-types";

export type ApoListDateGroup = DateGroup<ApoListRow>;

/** 日付が無いときの見出し・値の表記 */
export const APO_LIST_UNDATED_LABEL = "日付未定";

/**
 * 日付でグループ化する。
 *
 * 商談進捗の一覧タブと同じ groupItemsByDate を使う。基準にするのは
 * 商談・資料送付予定日時そのものの日付（初回商談実施日で埋めない）。
 * 日付未定は末尾に回る。
 *
 * 絞り込みはこの関数を呼ぶ前に済ませること。グループは案件が
 * あるときだけ作られるので、0件の日付の見出しだけが残ることはない。
 */
export function groupApoListRowsByDate(
  rows: readonly ApoListRow[],
): ApoListDateGroup[] {
  return groupItemsByDate(rows, {
    ymdOf: (row) => row.scheduledYmd,
    labelOf: (row) => row.scheduledDateLabel || APO_LIST_UNDATED_LABEL,
  });
}

/**
 * 商談・資料送付予定日時の表示（例: 2026/06/12 14:00）。
 *
 * 時刻が空なら日付だけを出す。商談予定カードの編集不可表示と同じ流儀で、
 * 「--:--」のような埋め草は入れない。
 * 日付が空なら「日付未定」。値が何も無いことが分かるようにする。
 */
export function formatApoListScheduledDateTime(row: {
  scheduledYmd: string;
  scheduledTime: string;
}): string {
  const date = formatDisplayYmd(row.scheduledYmd);
  if (!date) return APO_LIST_UNDATED_LABEL;

  const time = row.scheduledTime.trim();
  return time ? `${date} ${time}` : date;
}
