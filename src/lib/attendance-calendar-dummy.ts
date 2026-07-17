/** 月間カレンダー用の1日分打刻データ */
export type AttendanceDayRecord = {
  id: string;
  date: string;
  checkIn: string;
  checkOut: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** 当月を中心にしたテスト用ダミーデータ */
export function buildAttendanceCalendarDummy(
  year = new Date().getFullYear(),
  month = new Date().getMonth() + 1,
): AttendanceDayRecord[] {
  const lastDay = new Date(year, month, 0).getDate();
  const samples: Array<{ day: number; checkIn: string; checkOut: string }> = [
    { day: 1, checkIn: "09:00", checkOut: "18:00" },
    { day: 2, checkIn: "08:55", checkOut: "18:05" },
    { day: 3, checkIn: "09:10", checkOut: "18:30" },
    { day: 4, checkIn: "09:00", checkOut: "" },
    { day: 7, checkIn: "08:50", checkOut: "17:45" },
    { day: 8, checkIn: "09:05", checkOut: "18:15" },
    { day: 9, checkIn: "09:00", checkOut: "18:00" },
    { day: 10, checkIn: "08:58", checkOut: "18:02" },
    { day: 11, checkIn: "09:15", checkOut: "19:00" },
    { day: 14, checkIn: "09:00", checkOut: "18:00" },
    { day: 15, checkIn: "09:00", checkOut: "18:00" },
    { day: 16, checkIn: "08:45", checkOut: "17:30" },
    { day: 17, checkIn: "09:00", checkOut: "" },
  ];

  return samples
    .filter((s) => s.day <= lastDay)
    .map((s) => ({
      id: `${year}-${pad2(month)}-${pad2(s.day)}`,
      date: ymd(year, month, s.day),
      checkIn: s.checkIn,
      checkOut: s.checkOut,
    }));
}

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
