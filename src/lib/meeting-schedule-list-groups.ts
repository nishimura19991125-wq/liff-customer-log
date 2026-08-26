import type { MeetingScheduleItem } from "@/lib/meeting-schedule-types";

export type DateGroup<T> = {
  /** YYYY-MM-DD。日付未定は空 */
  ymd: string;
  /** 見出し（「6月12日（金）」など）。日付未定は「日付未定」 */
  label: string;
  items: T[];
};

export type MeetingScheduleDateGroup = DateGroup<MeetingScheduleItem>;

/** 日付が無いレコードをまとめるための内部キー */
const UNDATED_KEY = "__undated__";

/** 日付未定を末尾へ回すための番兵 */
const UNDATED_SORT_KEY = "9999-12-31";

/**
 * 日付でグループ化する（汎用）。
 *
 * グループは案件があるときだけ作るので、**空のグループはできない**。
 * 絞り込みはこの関数を呼ぶ前に済ませること。そうすれば
 * 0件になった日付の見出しだけが残ることはない。
 *
 * 日付・見出しの取り出し方は呼び出し側から渡す。商談進捗の一覧と
 * アポ情報一覧で持っているフィールド名が違うため
 * （前者は scheduledYmd / scheduledDateLabel、後者は別名）。
 */
export function groupItemsByDate<T>(
  items: readonly T[],
  accessors: {
    /** グループ化の基準になる日付（YYYY-MM-DD。無ければ空） */
    ymdOf: (item: T) => string;
    /** 見出しの文言。同じ日付のうち先頭の要素から取る */
    labelOf: (item: T) => string;
  },
): DateGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = accessors.ymdOf(item) || UNDATED_KEY;
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }

  return [...map.entries()]
    .map(([key, groupItems]) => ({
      ymd: key === UNDATED_KEY ? "" : key,
      label: groupItems[0] ? accessors.labelOf(groupItems[0]) : "日付未定",
      items: groupItems,
    }))
    .sort((a, b) =>
      (a.ymd || UNDATED_SORT_KEY).localeCompare(b.ymd || UNDATED_SORT_KEY),
    );
}

/**
 * 商談進捗の一覧タブの日付グルーピング。
 *
 * 中身は groupItemsByDate に委ねる。日付は scheduledYmd（未設定のときは
 * 初回商談実施日で埋まる。一覧のソート用の既存仕様）を使う。
 */
export function groupMeetingScheduleItemsByDate(
  items: readonly MeetingScheduleItem[],
): MeetingScheduleDateGroup[] {
  return groupItemsByDate(items, {
    ymdOf: (item) => item.scheduledYmd,
    labelOf: (item) => item.scheduledDateLabel || "日付未定",
  });
}
