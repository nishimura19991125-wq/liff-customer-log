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

/** 生の日時文字列から表示用 HH:mm を抽出（ISO UTC は JST に変換） */
export function extractDisplayHHmm(raw: string | null | undefined): string {
  if (!raw?.trim()) return "";
  const s = raw.trim();

  // タイムゾーン付き ISO → Asia/Tokyo の時刻
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(d);
    }
  }

  const normalized = s.replace("T", " ");
  const m = /(\d{1,2}):(\d{2})/.exec(normalized);
  if (!m) return "";
  return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
}

/** UI 表示用（空なら —） */
export function formatAttendanceDisplayTime(
  raw: string | null | undefined,
): string {
  return extractDisplayHHmm(raw) || "—";
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
