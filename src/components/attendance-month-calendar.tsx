"use client";

import { useEffect, useMemo, useState } from "react";

import { useLiffSwr } from "@/hooks/use-liff-swr";
import {
  attendanceRecordsByDate,
  formatAttendanceTimeRange,
  type AttendanceDayRecord,
} from "@/lib/attendance-calendar-types";
import { LIFF_SWR_ATTENDANCE_OPTIONS } from "@/lib/liff-swr";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

type CalendarCell = {
  day: number;
  dateKey: string;
  inMonth: boolean;
};

type MonthCalendarApiResponse = {
  configured?: boolean;
  year?: number;
  month?: number;
  staffName?: string;
  records?: AttendanceDayRecord[];
  needsStaffBind?: boolean;
  configError?: string;
  rateLimited?: boolean;
  error?: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatMonthTitle(year: number, month: number): string {
  return `${year}年${month}月`;
}

function formatDateLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

function buildMonthCells(year: number, month: number): CalendarCell[] {
  const first = new Date(year, month - 1, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const prevMonthDays = new Date(year, month - 1, 0).getDate();
  const cells: CalendarCell[] = [];

  for (let i = 0; i < 42; i++) {
    const dayIndex = i - startOffset + 1;
    if (dayIndex < 1) {
      const day = prevMonthDays + dayIndex;
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      cells.push({
        day,
        dateKey: `${prevYear}-${pad2(prevMonth)}-${pad2(day)}`,
        inMonth: false,
      });
    } else if (dayIndex > daysInMonth) {
      const day = dayIndex - daysInMonth;
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      cells.push({
        day,
        dateKey: `${nextYear}-${pad2(nextMonth)}-${pad2(day)}`,
        inMonth: false,
      });
    } else {
      cells.push({
        day: dayIndex,
        dateKey: `${year}-${pad2(month)}-${pad2(dayIndex)}`,
        inMonth: true,
      });
    }
  }

  return cells;
}

function DayDetailSheet({
  dateKey,
  record,
  onClose,
}: {
  dateKey: string;
  record: AttendanceDayRecord | undefined;
  onClose: () => void;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const checkIn = record?.checkIn?.trim() ?? "";
  const checkOut = record?.checkOut?.trim() ?? "";
  const hasAny = Boolean(checkIn || checkOut);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="閉じる"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="attendance-day-detail-title"
        className="relative w-full max-w-md rounded-t-2xl bg-white px-5 pb-6 pt-4 shadow-xl dark:bg-slate-900 md:rounded-2xl"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700 md:hidden" />
        <h3
          id="attendance-day-detail-title"
          className="text-[16px] font-bold text-slate-900 dark:text-white"
        >
          {formatDateLabel(dateKey)}
        </h3>
        {hasAny ? (
          <dl className="mt-4 space-y-3">
            {checkIn ? (
              <div>
                <dt className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
                  出勤
                </dt>
                <dd className="mt-0.5 text-[18px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {checkIn}
                </dd>
              </div>
            ) : null}
            {checkOut ? (
              <div>
                <dt className="text-[12px] font-medium text-slate-500 dark:text-slate-400">
                  退勤
                </dt>
                <dd className="mt-0.5 text-[18px] font-bold tabular-nums text-slate-800 dark:text-slate-100">
                  {checkOut}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="mt-4 text-[14px] text-slate-500 dark:text-slate-400">
            この日の打刻はありません
          </p>
        )}
        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-xl bg-slate-900 py-3 text-[14px] font-semibold text-white dark:bg-white dark:text-slate-900"
        >
          閉じる
        </button>
      </div>
    </div>
  );
}

export function AttendanceMonthCalendar({
  idToken,
}: {
  idToken: string;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);

  const path = `/api/attendance/calendar?year=${year}&month=${month}`;
  const { data, error, isLoading } = useLiffSwr<MonthCalendarApiResponse>(
    path,
    idToken,
    LIFF_SWR_ATTENDANCE_OPTIONS,
  );

  const records = data?.records ?? [];
  const byDate = useMemo(() => attendanceRecordsByDate(records), [records]);
  const cells = useMemo(() => buildMonthCells(year, month), [year, month]);
  const selectedRecord = selectedDateKey ? byDate[selectedDateKey] : undefined;
  const loading = isLoading && !data;

  function goPrevMonth() {
    if (month === 1) {
      setYear((y) => y - 1);
      setMonth(12);
      return;
    }
    setMonth((m) => m - 1);
  }

  function goNextMonth() {
    if (month === 12) {
      setYear((y) => y + 1);
      setMonth(1);
      return;
    }
    setMonth((m) => m + 1);
  }

  return (
    <section aria-label="勤怠カレンダー">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-bold text-slate-800 dark:text-slate-100">
          勤怠カレンダー
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goPrevMonth}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            前月
          </button>
          <span className="min-w-[5.5rem] text-center text-[13px] font-bold tabular-nums text-slate-800 dark:text-slate-100">
            {formatMonthTitle(year, month)}
          </span>
          <button
            type="button"
            onClick={goNextMonth}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            翌月
          </button>
        </div>
      </div>

      {data?.configError || error ? (
        <p className="mb-2 text-[12px] text-amber-800 dark:text-amber-200">
          {data?.configError ?? error?.message}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-700">
          {WEEKDAYS.map((label, i) => (
            <div
              key={label}
              className={`py-2 text-center text-[11px] font-bold ${
                i === 0
                  ? "text-rose-500"
                  : i === 6
                    ? "text-sky-600 dark:text-sky-400"
                    : "text-slate-500 dark:text-slate-400"
              }`}
            >
              {label}
            </div>
          ))}
        </div>

        <div className={`grid grid-cols-7 ${loading ? "opacity-60" : ""}`}>
          {cells.map((cell) => {
            const record = byDate[cell.dateKey];
            const timeRange = formatAttendanceTimeRange(
              record?.checkIn,
              record?.checkOut,
            );
            const hasPunch = Boolean(timeRange);
            const isSunday = new Date(`${cell.dateKey}T12:00:00`).getDay() === 0;
            const isSaturday =
              new Date(`${cell.dateKey}T12:00:00`).getDay() === 6;

            return (
              <button
                key={cell.dateKey}
                type="button"
                onClick={() => {
                  if (window.matchMedia("(max-width: 767px)").matches) {
                    setSelectedDateKey(cell.dateKey);
                  }
                }}
                className={`min-h-[4.5rem] border-b border-r border-slate-100 p-1.5 text-left transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50 sm:min-h-[5.5rem] md:min-h-[6rem] ${
                  cell.inMonth
                    ? "bg-white dark:bg-slate-900"
                    : "bg-slate-50/80 dark:bg-slate-950/40"
                }`}
              >
                <span
                  className={`block text-[12px] font-semibold tabular-nums ${
                    !cell.inMonth
                      ? "text-slate-300 dark:text-slate-600"
                      : isSunday
                        ? "text-rose-500"
                        : isSaturday
                          ? "text-sky-600 dark:text-sky-400"
                          : "text-slate-700 dark:text-slate-200"
                  }`}
                >
                  {cell.day}
                </span>

                {hasPunch ? (
                  <>
                    <span
                      className="mt-1 block size-1.5 rounded-full bg-emerald-500 md:hidden"
                      aria-hidden
                    />
                    <span className="mt-1 hidden text-[10px] leading-tight tabular-nums text-emerald-700 dark:text-emerald-400 md:block">
                      {timeRange}
                    </span>
                  </>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <p className="mt-2 text-[12px] text-slate-500 dark:text-slate-400">
          打刻データを読み込み中…
        </p>
      ) : null}

      {selectedDateKey ? (
        <DayDetailSheet
          dateKey={selectedDateKey}
          record={selectedRecord}
          onClose={() => setSelectedDateKey(null)}
        />
      ) : null}
    </section>
  );
}
