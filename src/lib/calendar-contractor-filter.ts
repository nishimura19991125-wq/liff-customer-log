import type { CalendarMonthApiItem } from "@/lib/calendar-api-types";
import { formatMonthDayWithWeekday } from "@/lib/format-weekday-date";

/**
 * 工事カレンダーの施工店フィルタ・表示モード・空き枠サマリ（タスクI）。
 *
 * すべて表示のための純粋関数。@pocket への読み書きは一切行わない。
 *
 * 前提（I-1 で確認済み）:
 *   - CalendarMonthApiItem.category が "empty" のとき**未割当の空き枠**。
 *     お客様名が空のレコードがこれにあたる（fill-empty-slot の判定と同じ基準）。
 *     案件が割り当たると "list" になるため、"empty" を数えるだけで
 *     「まだ割り当てられていない枠」になる。
 *   - CalendarMonthApiItem.contractorKey は施工会社名そのもの。
 *     未設定のレコードはサーバ側で "__UNSET__" が入る。
 */

/** 施工会社が未設定のレコードにサーバが入れるキー（calendar-kojo.ts と同値） */
export const CALENDAR_UNSET_CONTRACTOR_KEY = "__UNSET__";

/** 画面に出すラベル。未設定はそのままだと意味が伝わらないので言い換える */
export function calendarContractorLabel(contractorKey: string): string {
  return contractorKey === CALENDAR_UNSET_CONTRACTOR_KEY
    ? "未設定"
    : contractorKey;
}

export type CalendarDisplayMode = "all" | "empty" | "list";

export const CALENDAR_DISPLAY_MODE_LABELS: ReadonlyArray<{
  value: CalendarDisplayMode;
  label: string;
}> = [
  { value: "all", label: "すべて" },
  { value: "empty", label: "空き枠のみ" },
  { value: "list", label: "工事日のみ" },
];

type ByDay = Record<string, CalendarMonthApiItem[]>;

/**
 * 表示中の月に実際に出ている施工会社を集める。
 *
 * マスタの全社を並べると、その月に1件もない会社まで並んで使いにくいため、
 * データに含まれるものだけを選択肢にする。
 * 並びは名前順で、「未設定」は最後に置く。
 */
export function collectCalendarContractors(
  byDay: ByDay | undefined | null,
): string[] {
  const keys = new Set<string>();
  for (const items of Object.values(byDay ?? {})) {
    for (const item of items) {
      const key = item.contractorKey?.trim();
      if (key) keys.add(key);
    }
  }

  const named = [...keys]
    .filter((k) => k !== CALENDAR_UNSET_CONTRACTOR_KEY)
    .sort((a, b) => a.localeCompare(b, "ja"));
  return keys.has(CALENDAR_UNSET_CONTRACTOR_KEY)
    ? [...named, CALENDAR_UNSET_CONTRACTOR_KEY]
    : named;
}

function matchesDisplayMode(
  item: CalendarMonthApiItem,
  mode: CalendarDisplayMode,
): boolean {
  if (mode === "all") return true;
  if (mode === "empty") return item.category === "empty";
  return item.category === "list";
}

/**
 * 施工店フィルタと表示モードを同時に適用する。
 *
 * selectedContractors は「表示する施工会社」の集合。空き枠・案件の両方に効く。
 * 日付ごとの配列が空になった場合はキーごと落とす（バッジ件数が 0 になるだけで
 * 元の byDay を壊さないよう、新しいオブジェクトを返す）。
 */
export function filterCalendarByDay(
  byDay: ByDay | undefined | null,
  options: {
    selectedContractors: ReadonlySet<string>;
    mode: CalendarDisplayMode;
  },
): ByDay {
  const out: ByDay = {};
  for (const [dayKey, items] of Object.entries(byDay ?? {})) {
    const kept = items.filter(
      (item) =>
        options.selectedContractors.has(item.contractorKey) &&
        matchesDisplayMode(item, options.mode),
    );
    if (kept.length > 0) out[dayKey] = kept;
  }
  return out;
}

export type CalendarEmptySlotSummary = {
  contractorKey: string;
  label: string;
  /** 表示中の月の残り空き枠数 */
  count: number;
  /** 最短の空き枠日（YYYY-MM-DD）。今日より前は除外。無ければ null */
  earliestDayKey: string | null;
  /** `9/5(金)`。earliestDayKey が無ければ空文字 */
  earliestLabel: string;
};

/**
 * 施工会社ごとの残り空き枠数と最短日を求める。
 *
 * - 件数は表示中の月の "empty" のみ。割り当て済み（"list"）は数えない
 * - 最短日は **今日以降**の空き枠だけを見る。過去日は「最短で工事できる日」に
 *   ならないため除外する。過去の月を表示しているときは全日が対象外になり
 *   earliestDayKey は null になる
 * - 表示モードには影響されない。「工事日のみ」でも空き枠の情報として出す
 *
 * todayKey は YYYY-MM-DD。文字列比較で日付順になる形式なので直接比較できる。
 */
export function summarizeCalendarEmptySlots(
  byDay: ByDay | undefined | null,
  options: { todayKey: string; contractorKeys?: readonly string[] },
): CalendarEmptySlotSummary[] {
  const counts = new Map<string, number>();
  const earliest = new Map<string, string>();

  for (const [dayKey, items] of Object.entries(byDay ?? {})) {
    for (const item of items) {
      if (item.category !== "empty") continue;
      const key = item.contractorKey?.trim();
      if (!key) continue;

      counts.set(key, (counts.get(key) ?? 0) + 1);

      // 過去日は最短日の候補にしない（件数には含める）
      if (dayKey < options.todayKey) continue;
      const current = earliest.get(key);
      if (!current || dayKey < current) earliest.set(key, dayKey);
    }
  }

  const keys =
    options.contractorKeys ??
    collectCalendarContractors(byDay).filter((k) => counts.has(k));

  return keys.map((contractorKey) => {
    const earliestDayKey = earliest.get(contractorKey) ?? null;
    return {
      contractorKey,
      label: calendarContractorLabel(contractorKey),
      count: counts.get(contractorKey) ?? 0,
      earliestDayKey,
      earliestLabel: earliestDayKey
        ? formatMonthDayWithWeekday(earliestDayKey)
        : "",
    };
  });
}

/** サマリ1件分の表示文字列（`残り12件 / 最短 9/5(金)` など） */
export function formatCalendarEmptySlotSummary(
  summary: CalendarEmptySlotSummary,
): string {
  if (summary.count === 0) return "残りなし";
  if (!summary.earliestLabel) return `残り${summary.count}件`;
  return `残り${summary.count}件 / 最短 ${summary.earliestLabel}`;
}

/** フィルタ後の表示件数（aria-live で読み上げる） */
export function countCalendarItems(byDay: ByDay | undefined | null): number {
  let total = 0;
  for (const items of Object.values(byDay ?? {})) total += items.length;
  return total;
}
