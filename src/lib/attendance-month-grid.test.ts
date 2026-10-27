import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ATTENDANCE_WEEKDAY_LABELS,
  attendanceWeekdayTone,
  buildAttendanceMonthCells,
} from "@/lib/attendance-month-grid";
import { buildSundayStartMonthGrid } from "@/lib/construction-management-view";

/**
 * 勤怠カレンダーのマス（月曜始まり）。
 * 施工カレンダーは日曜始まりのまま。
 */

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

function dow(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

describe("★ 勤怠カレンダーは月曜始まり", () => {
  it("★ 曜日の見出しは月曜から日曜", () => {
    expect([...ATTENDANCE_WEEKDAY_LABELS]).toEqual(["月", "火", "水", "木", "金", "土", "日"]);
  });

  it("★ 土曜は6列目、日曜は7列目の色", () => {
    expect(attendanceWeekdayTone(5)).toBe("saturday");
    expect(attendanceWeekdayTone(6)).toBe("sunday");
    for (const i of [0, 1, 2, 3, 4]) expect(attendanceWeekdayTone(i)).toBe("weekday");
  });

  it("★ マスは6週×7日で、各行が月曜に始まり日曜に終わる", () => {
    for (const [y, m] of [[2026, 10], [2026, 11], [2026, 2], [2027, 1]] as const) {
      const cells = buildAttendanceMonthCells(y, m);
      expect(cells).toHaveLength(42);
      for (let row = 0; row < 6; row++) {
        expect(dow(cells[row * 7]!.dateKey)).toBe(1);
        expect(dow(cells[row * 7 + 6]!.dateKey)).toBe(0);
      }
    }
  });

  it("★ 1日が日曜の月は、前の月のマスが6つ（2026-11）", () => {
    const cells = buildAttendanceMonthCells(2026, 11);
    expect(cells.slice(0, 6).every((c) => !c.inMonth)).toBe(true);
    expect(cells[0]!.dateKey).toBe("2026-10-26");
    expect(cells[6]).toEqual({ day: 1, dateKey: "2026-11-01", inMonth: true });
  });

  it("★ 1日が月曜の月は、前の月のマスが無い（2026-06）", () => {
    const cells = buildAttendanceMonthCells(2026, 6);
    expect(cells[0]).toEqual({ day: 1, dateKey: "2026-06-01", inMonth: true });
  });

  it("★ 1日が木曜の月（2026-10）は前の月のマスが3つ", () => {
    const cells = buildAttendanceMonthCells(2026, 10);
    expect(cells.slice(0, 3).map((c) => c.dateKey)).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
    ]);
    expect(cells[3]!.dateKey).toBe("2026-10-01");
  });

  it("★ 月末のあとは翌月のマスで埋まる（年をまたぐ 2026-12）", () => {
    const cells = buildAttendanceMonthCells(2026, 12);
    const lastIn = cells.findIndex((c) => c.dateKey === "2026-12-31");
    expect(cells[lastIn]!.inMonth).toBe(true);
    expect(cells[lastIn + 1]).toEqual({ day: 1, dateKey: "2027-01-01", inMonth: false });
    expect(cells.at(-1)!.dateKey).toBe("2027-01-10");
  });

  it("★ 1月の前の月のマスは前年の12月（2027-01）", () => {
    const cells = buildAttendanceMonthCells(2027, 1);
    // 2027-01-01 は金曜 → 前の月のマスは 12/28〜12/31 の4つ
    expect(cells.slice(0, 4).map((c) => c.dateKey)).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
    ]);
  });

  it("★ その月の日は1日から末日まで、抜けも重複もない", () => {
    const days = buildAttendanceMonthCells(2026, 2).filter((c) => c.inMonth);
    expect(days.map((c) => c.day)).toEqual(Array.from({ length: 28 }, (_, i) => i + 1));
  });

  it("★ 画面はこのモジュールの見出しとマスを使っている", () => {
    const src = read("src/components/attendance-month-calendar.tsx");
    expect(src).toContain("ATTENDANCE_WEEKDAY_LABELS");
    expect(src).toContain("buildAttendanceMonthCells");
    expect(src).toContain("attendanceWeekdayTone");
    expect(src).not.toMatch(/\["日", "月", "火"/);
  });

  it("★ なぜ月曜始まりかがコメントに残っている（休みの登録画面と揃えるため）", () => {
    const src = read("src/lib/attendance-month-grid.ts");
    expect(src).toContain("休みの登録画面");
    expect(src).toContain("施工カレンダー");
  });
});

describe("★ 施工カレンダーは日曜始まりのまま", () => {
  it("★ 工事カレンダーのタブの曜日の見出しは日曜から", () => {
    expect(read("src/components/liff-calendar-month-page.tsx")).toContain(
      'const WEEK_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;',
    );
  });

  it("★ 施工管理タブの見出しは日曜から、マスは日曜に始まる", () => {
    expect(read("src/components/construction-management-panel.tsx")).toContain(
      'const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;',
    );
    // 各行の先頭は日曜（2026-10 は 10/1 が木曜 → 先頭は 9/27(日)）
    const grid = buildSundayStartMonthGrid(2026, 10);
    expect(grid[0]!.dayKey).toBe("2026-09-27");
    for (let i = 0; i < grid.length; i += 7) expect(grid[i]!.weekday).toBe(0);
  });
});
