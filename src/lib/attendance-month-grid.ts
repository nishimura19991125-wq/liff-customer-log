/**
 * 勤怠カレンダー（勤怠画面の「今月の記録」）の曜日とマス。
 *
 * ■ 勤怠カレンダーは**月曜始まり**。施工カレンダーは日曜始まりのまま
 * アプリ内でカレンダーの始まりが2通りになるが、意図したもの。
 * 勤怠だけ月曜始まりにしたのは、**休みの登録画面**（来週の月曜から2週間・
 * 月曜始まり日曜締め）と揃えるため。休みを登録した週と、勤怠カレンダーで
 * 見る週の区切りが同じになる。
 * 施工カレンダー（工事カレンダー・施工管理のタブ）は従来どおり日曜始まりで、
 * こちらに合わせて変える必要はない。
 */

/** 曜日の見出し（月曜から日曜） */
export const ATTENDANCE_WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"] as const;

/** 見出しの列（0始まり）の色分け。土曜は6列目（5）、日曜は7列目（6） */
export function attendanceWeekdayTone(
  columnIndex: number,
): "weekday" | "saturday" | "sunday" {
  if (columnIndex === 5) return "saturday";
  if (columnIndex === 6) return "sunday";
  return "weekday";
}

export type AttendanceCalendarCell = {
  day: number;
  dateKey: string;
  inMonth: boolean;
};

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/**
 * 月のマス（6週×7日＝42マス・月曜始まり）。前後の月の日で埋める。
 * 暦の計算は UTC で行う（端末のタイムゾーンに左右されない）。
 */
export function buildAttendanceMonthCells(
  year: number,
  month: number,
): AttendanceCalendarCell[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  // 月曜を0とした1日の位置（日曜は6）
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: AttendanceCalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(Date.UTC(year, month - 1, 1 - lead + i));
    cells.push({
      day: d.getUTCDate(),
      dateKey: ymd(d),
      inMonth: d.getUTCMonth() === month - 1 && d.getUTCFullYear() === year,
    });
  }
  return cells;
}
