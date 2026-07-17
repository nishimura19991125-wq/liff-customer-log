/** 月間カレンダー用の1日分打刻データ */
export type AttendanceDayRecord = {
  id: string;
  date: string;
  checkIn: string;
  checkOut: string;
};

/** 日付キーで引けるマップに変換 */
export function attendanceRecordsByDate(
  records: AttendanceDayRecord[],
): Record<string, AttendanceDayRecord> {
  const map: Record<string, AttendanceDayRecord> = {};
  for (const r of records) {
    map[r.date] = r;
  }
  return map;
}

/** 生の日時文字列から HH:mm を抽出。取れなければ空文字 */
export function extractDisplayHHmm(raw: string | null | undefined): string {
  if (!raw?.trim()) return "";
  const s = raw.trim().replace("T", " ");
  const m = /(\d{1,2}):(\d{2})/.exec(s);
  if (!m) return "";
  return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
}

/**
 * 出勤・退勤のうち値があるものだけを「〜」でつなぐ。
 * どちらも空なら null（表記なし）。
 */
export function formatAttendanceTimeRange(
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
): string | null {
  const inn = (checkIn ?? "").trim();
  const out = (checkOut ?? "").trim();
  if (inn && out) return `${inn} 〜 ${out}`;
  if (inn) return inn;
  if (out) return out;
  return null;
}
