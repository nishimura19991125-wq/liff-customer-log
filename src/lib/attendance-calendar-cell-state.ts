import {
  formatAttendanceTimeRange,
  type AttendanceDayRecord,
} from "@/lib/attendance-calendar-types";
import { jstYmd } from "@/lib/jst-hm";

/**
 * 勤怠カレンダーのマスの状態（休暇・段階3）。
 *
 * 画面を描くテストの仕組みが無いので、状態を決める処理をここへ切り出した
 * （施工管理タブの construction-management-view.ts と同じやり方）。
 */

/** /api/attendance/calendar の応答のうち、マスの状態に使う項目 */
export type AttendanceCalendarData = {
  year?: number;
  month?: number;
  records?: AttendanceDayRecord[];
  recordsComplete?: boolean;
  leaves?: string[] | null;
  leavesStatus?: "disabled" | "ok" | "error";
};

export type AttendanceCellState = {
  hasPunch: boolean;
  /** 休みの登録がある */
  isLeave: boolean;
  /** 赤く塗る（過去の日で、打刻も休みの登録も無い） */
  isMissing: boolean;
};

/**
 * 「打刻も休みも無い」と言い切れるか。
 *
 * 次のどれかなら言い切れないので、赤く塗らない。
 *   - 打刻の取得が完全でなかった（recordsComplete が true でない）
 *     … 取れなかっただけで「打刻が無い」とは限らない
 *   - 休暇アプリが ok でない（disabled・error・項目なし）
 *     … 休みの登録が分からないまま塗ると、休んだ日が無断欠勤に見える
 *   - 応答が表示中の月のものでない（月を切り替えた直後は前の月の応答が残る）
 */
export function canFlagMissingDays(
  data: AttendanceCalendarData | undefined,
  viewYear: number,
  viewMonth: number,
): boolean {
  if (!data) return false;
  if (data.year !== viewYear || data.month !== viewMonth) return false;
  if (data.recordsComplete !== true) return false;
  if (data.leavesStatus !== "ok" || !Array.isArray(data.leaves)) return false;
  return true;
}

/** 休みの日付。休暇アプリが ok で、表示中の月の応答のときだけ */
function leaveDateSet(
  data: AttendanceCalendarData | undefined,
  viewYear: number,
  viewMonth: number,
): Set<string> {
  if (!data || data.year !== viewYear || data.month !== viewMonth) return new Set();
  if (data.leavesStatus !== "ok" || !Array.isArray(data.leaves)) return new Set();
  return new Set(data.leaves);
}

/**
 * マスごとの状態を返す（キーは YYYY-MM-DD）。
 *
 * 「当日」は JST で決める。端末の時計の日付は使わない
 * （海外設定の端末や日付の変わり目で、当日が過去扱いになるのを防ぐ）。
 * 土日祝は除外しない（出勤する人がいるため）。
 */
export function buildAttendanceCellStates(
  cells: ReadonlyArray<{ dateKey: string; inMonth: boolean }>,
  data: AttendanceCalendarData | undefined,
  viewYear: number,
  viewMonth: number,
  now: Date = new Date(),
): Map<string, AttendanceCellState> {
  const today = jstYmd(now);
  const flag = canFlagMissingDays(data, viewYear, viewMonth);
  const leaves = leaveDateSet(data, viewYear, viewMonth);
  const punched = new Set<string>();
  for (const r of data?.records ?? []) {
    if (formatAttendanceTimeRange(r.checkIn, r.checkOut)) punched.add(r.date);
  }

  const out = new Map<string, AttendanceCellState>();
  for (const c of cells) {
    const hasPunch = punched.has(c.dateKey);
    const isLeave = c.inMonth && leaves.has(c.dateKey);
    const isMissing =
      flag && c.inMonth && c.dateKey < today && !hasPunch && !isLeave;
    out.set(c.dateKey, { hasPunch, isLeave, isMissing });
  }
  return out;
}
