import type { MeetingScheduleItem } from "@/lib/meeting-schedule-types";

export type MeetingScheduleDateGroup = {
  /** YYYY-MM-DD。日付未定は空 */
  ymd: string;
  /** 見出し（「6月12日（金）」など）。日付未定は「日付未定」 */
  label: string;
  items: MeetingScheduleItem[];
};

/**
 * 一覧タブの日付グルーピング。
 *
 * グループは案件があるときだけ作るので、**空のグループはできない**。
 * 絞り込みはこの関数を呼ぶ前に済ませること。そうすれば
 * 0件になった日付の見出しだけが残ることはない。
 */
export function groupMeetingScheduleItemsByDate(
  items: readonly MeetingScheduleItem[],
): MeetingScheduleDateGroup[] {
  const map = new Map<string, MeetingScheduleItem[]>();
  for (const item of items) {
    const key = item.scheduledYmd || "__undated__";
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }

  return [...map.entries()]
    .map(([key, groupItems]) => ({
      ymd: key === "__undated__" ? "" : key,
      label: groupItems[0]?.scheduledDateLabel ?? "日付未定",
      items: groupItems,
    }))
    .sort((a, b) =>
      (a.ymd || "9999-12-31").localeCompare(b.ymd || "9999-12-31"),
    );
}
