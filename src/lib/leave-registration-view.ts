import { jstYmd } from "@/lib/jst-hm";

/**
 * 休みの登録画面の計算と判定（休暇・段階5）。
 *
 * 画面を描くテストの仕組みが無いので、ここへ切り出してテストする。
 * 登録できる期間（来週の月曜から2週間）はサーバが決めて返す
 * （登録 API と同じ leaveRegistrationWindow）。画面はその開始日から週を組む。
 *
 * 日付は YYYY-MM-DD の文字列で扱い、曜日や日数の計算は UTC の暦で行う。
 * 端末のタイムゾーンや時計の日付は使わない。「今日」は jstYmd で決める。
 */

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

function parts(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split("-").map(Number);
  return [y!, m!, d!];
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = parts(ymd);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekdayOf(ymd: string): number {
  const [y, m, d] = parts(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export type LeaveWeek = {
  /** 1 or 2 */
  index: number;
  label: string;
  /** 月曜〜日曜の7日 */
  days: string[];
};

/** 開始日（来週の月曜）から、第1週・第2週を組み立てる */
export function buildLeaveWeeks(start: string): LeaveWeek[] {
  return [1, 2].map((index) => ({
    index,
    label: `第${index}週`,
    days: Array.from({ length: 7 }, (_, i) => addDays(start, (index - 1) * 7 + i)),
  }));
}

/** 「11/2(月)」 */
export function formatLeaveDayLabel(ymd: string): string {
  const [, m, d] = parts(ymd);
  return `${m}/${d}(${WEEKDAY_LABELS[weekdayOf(ymd)]})`;
}

/** その月の第一・第三水曜（YYYY-MM-DD） */
function deadlinesOfMonth(year: number, month: number): string[] {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const firstWed = addDays(first, (3 - weekdayOf(first) + 7) % 7);
  return [firstWed, addDays(firstWed, 14)];
}

/**
 * 次の締め切り日（第一・第三水曜）。JST の今日を含む（当日はまだ間に合う扱い）。
 * 表示するだけで、登録は止めない。
 */
export function nextLeaveDeadline(now: Date = new Date()): string {
  const today = jstYmd(now);
  const [y, m] = parts(today);
  const hit = deadlinesOfMonth(y, m).find((d) => d >= today);
  if (hit) return hit;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return deadlinesOfMonth(nextY, nextM)[0]!;
}

/** 1つの週（月曜〜日曜）に休みにできる日数。登録済みの日も数える */
export const LEAVE_MAX_DAYS_PER_WEEK = 2;

/** その日が属する週の月曜（YYYY-MM-DD）。週は月曜始まり */
export function leaveWeekKey(ymd: string): string {
  return addDays(ymd, -((weekdayOf(ymd) + 6) % 7));
}

/** 週の使用数（登録済み＋選択中。同じ日は1回だけ数える） */
export function leaveWeekUsage(
  weekDays: readonly string[],
  selected: readonly string[],
  registered: ReadonlySet<string>,
): { used: number; limit: number; full: boolean } {
  const used = new Set(
    weekDays.filter((d) => registered.has(d) || selected.includes(d)),
  ).size;
  return {
    used,
    limit: LEAVE_MAX_DAYS_PER_WEEK,
    full: used >= LEAVE_MAX_DAYS_PER_WEEK,
  };
}

/**
 * 週の残り日数の案内。数え方は leaveWeekUsage のまま（登録済み＋選択中）。
 * 上限に達したら「残り0日です」のあとに、外せば選び直せることを添える。
 */
export function leaveWeekRemainingMessage(usage: {
  used: number;
  limit: number;
  full: boolean;
}): string {
  const rest = Math.max(0, usage.limit - usage.used);
  const head = `この週に登録できる休みは残り${rest}日です`;
  return usage.full
    ? `${head}。ほかの日にするときは、選んだ日を外してください。`
    : head;
}

/**
 * 選べる日か。
 *   - 表示している2週間の中で、まだ登録されていない
 *   - その週の使用数（登録済み＋選択中）が上限に達していない
 * selected を省略すると、選択中は数えない。
 */
export function isLeaveDaySelectable(
  date: string,
  shownDays: readonly string[],
  registered: ReadonlySet<string>,
  selected: readonly string[] = [],
): boolean {
  if (!shownDays.includes(date) || registered.has(date)) return false;
  if (selected.includes(date)) return true;
  const week = leaveWeekKey(date);
  const weekDays = shownDays.filter((d) => leaveWeekKey(d) === week);
  return !leaveWeekUsage(weekDays, selected, registered).full;
}

/**
 * 押した日の選択を切り替える（選べない日は無視する）。昇順で返す。
 * 選んだ日はいつでも外せる（上限に達していても）。
 */
export function toggleLeaveDate(
  selected: readonly string[],
  date: string,
  shownDays: readonly string[],
  registered: ReadonlySet<string>,
): string[] {
  if (selected.includes(date)) return selected.filter((d) => d !== date);
  if (!isLeaveDaySelectable(date, shownDays, registered, selected)) return [...selected];
  return [...selected, date].sort();
}

/**
 * 登録 API に送る本文。日付だけ（氏名はサーバが決める）。
 * 選んだあとで登録済みになった日は外す。
 */
export function leaveRegisterRequestBody(
  selected: readonly string[],
  registered: ReadonlySet<string>,
): { dates: string[] } {
  const dates = [...new Set(selected)].filter((d) => !registered.has(d)).sort();
  return { dates };
}

/** 登録 API（POST /api/attendance/leave）の応答 */
export type LeaveRegisterResponse = {
  ok?: boolean;
  error?: string;
  correlationId?: string;
  created?: string[];
  alreadyRegistered?: string[];
  failed?: string;
  notAttempted?: string[];
};

export type LeaveRegisterSummary = {
  kind: "success" | "partial" | "error";
  message: string;
};

/**
 * 結果を画面の文言にする。
 *   success … 全部登録できた
 *   partial … 途中で止まった。どこまで登録できたかと、送り直しの案内
 *   error   … 書く前に止まった（入力・紐付け・読み取りの失敗）
 */
export function summarizeLeaveRegisterResult(
  httpStatus: number,
  body: LeaveRegisterResponse,
): LeaveRegisterSummary {
  const created = body.created ?? [];
  const skipped = body.alreadyRegistered ?? [];

  if (body.ok && httpStatus >= 200 && httpStatus < 300) {
    const parts = [`${created.length}日分の休みを登録しました。`];
    if (skipped.length > 0) {
      parts.push(`${skipped.length}日はすでに登録済みでした。`);
    }
    return { kind: "success", message: parts.join("") };
  }

  if (body.failed) {
    const rest = 1 + (body.notAttempted?.length ?? 0);
    const id = body.correlationId ? `（ID: ${body.correlationId}）` : "";
    const head =
      created.length > 0
        ? `${formatLeaveDayLabel(created[created.length - 1]!)}まで登録しました。`
        : "登録できませんでした。";
    return {
      kind: "partial",
      message: `${head}残り${rest}日は登録できていません。もう一度送ると、残りの日だけを登録します。${id}`,
    };
  }

  return {
    kind: "error",
    message: body.error?.trim() || "休みの登録に失敗しました。しばらくしてから再度お試しください。",
  };
}
