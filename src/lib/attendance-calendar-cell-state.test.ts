import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildAttendanceCellStates,
  canFlagMissingDays,
  type AttendanceCalendarData,
} from "@/lib/attendance-calendar-cell-state";

/**
 * 勤怠カレンダーのマスの状態（休暇・段階3）。
 * 画面を描くテストの仕組みが無いので、状態を決める処理を切り出して見る。
 */

/** JST 2026-10-15 12:00 */
const NOW = new Date("2026-10-15T03:00:00Z");

function cell(dateKey: string, inMonth = true) {
  return { dateKey, inMonth };
}

function data(over: Partial<AttendanceCalendarData> = {}): AttendanceCalendarData {
  return {
    year: 2026,
    month: 10,
    records: [],
    recordsComplete: true,
    leaves: [],
    leavesStatus: "ok",
    ...over,
  };
}

function stateOf(
  dateKey: string,
  d: AttendanceCalendarData | undefined,
  opts: { inMonth?: boolean; now?: Date; year?: number; month?: number } = {},
) {
  const map = buildAttendanceCellStates(
    [cell(dateKey, opts.inMonth ?? true)],
    d,
    opts.year ?? 2026,
    opts.month ?? 10,
    opts.now ?? NOW,
  );
  return map.get(dateKey)!;
}

describe("★ 赤くする（打刻・休みの登録なし）", () => {
  it("★ 過去の日で打刻も休みも無い日は赤い", () => {
    expect(stateOf("2026-10-14", data()).isMissing).toBe(true);
  });

  it("★ 当日は赤くない", () => {
    expect(stateOf("2026-10-15", data()).isMissing).toBe(false);
  });

  it("★ 未来の日は赤くない", () => {
    expect(stateOf("2026-10-16", data()).isMissing).toBe(false);
  });

  it("★ 打刻がある日は赤くない", () => {
    const d = data({
      records: [{ id: "1", date: "2026-10-14", checkIn: "09:00", checkOut: "" }],
    });
    const s = stateOf("2026-10-14", d);
    expect(s.hasPunch).toBe(true);
    expect(s.isMissing).toBe(false);
  });

  it("★ 休みの登録がある日は赤くない", () => {
    const s = stateOf("2026-10-14", data({ leaves: ["2026-10-14"] }));
    expect(s.isLeave).toBe(true);
    expect(s.isMissing).toBe(false);
  });

  it("★ 土日も条件を満たせば赤い", () => {
    // 2026-10-10 は土曜、10-11 は日曜
    expect(stateOf("2026-10-10", data()).isMissing).toBe(true);
    expect(stateOf("2026-10-11", data()).isMissing).toBe(true);
  });

  it("★ 祝日も条件を満たせば赤い", () => {
    // 2026-10-12 はスポーツの日
    expect(stateOf("2026-10-12", data()).isMissing).toBe(true);
  });

  it("★ 前後の月のマスは赤くない", () => {
    expect(stateOf("2026-09-30", data(), { inMonth: false }).isMissing).toBe(false);
  });
});

describe("★ 取得が分からないときは赤くしない", () => {
  it("★ recordsComplete が false なら赤くない", () => {
    expect(stateOf("2026-10-14", data({ recordsComplete: false })).isMissing).toBe(false);
  });

  it("★ leavesStatus が disabled なら赤くない", () => {
    expect(
      stateOf("2026-10-14", data({ leavesStatus: "disabled", leaves: [] })).isMissing,
    ).toBe(false);
  });

  it("★ leavesStatus が error なら赤くない", () => {
    expect(
      stateOf("2026-10-14", data({ leavesStatus: "error", leaves: null })).isMissing,
    ).toBe(false);
  });

  it("★ leaves / leavesStatus が応答に無ければ赤くない（紐付けなし・勤怠未設定）", () => {
    const d = data();
    delete d.leaves;
    delete d.leavesStatus;
    expect(stateOf("2026-10-14", d).isMissing).toBe(false);
  });

  it("★ recordsComplete が応答に無ければ赤くない", () => {
    const d = data();
    delete d.recordsComplete;
    expect(stateOf("2026-10-14", d).isMissing).toBe(false);
  });

  it("★ 応答がまだ無ければ赤くない", () => {
    expect(stateOf("2026-10-14", undefined).isMissing).toBe(false);
  });

  it("★ 月を切り替えた直後（前の月の応答が残っている間）は赤くない", () => {
    // 表示は11月、応答はまだ10月のもの
    const s = stateOf("2026-11-02", data(), {
      year: 2026,
      month: 11,
      now: new Date("2026-11-20T03:00:00Z"),
    });
    expect(s.isMissing).toBe(false);
  });

  it("canFlagMissingDays は全部そろったときだけ true", () => {
    expect(canFlagMissingDays(data(), 2026, 10)).toBe(true);
    expect(canFlagMissingDays(data({ recordsComplete: false }), 2026, 10)).toBe(false);
    expect(canFlagMissingDays(data({ leavesStatus: "error" }), 2026, 10)).toBe(false);
    expect(canFlagMissingDays(data(), 2026, 11)).toBe(false);
    expect(canFlagMissingDays(undefined, 2026, 10)).toBe(false);
  });
});

describe("★ 当日は JST で決める", () => {
  it("★ UTC ではまだ前日でも、JST で日付が変わっていれば前日は過去", () => {
    // UTC 2026-10-14 15:30 = JST 2026-10-15 00:30
    const now = new Date("2026-10-14T15:30:00Z");
    expect(stateOf("2026-10-14", data(), { now }).isMissing).toBe(true);
    expect(stateOf("2026-10-15", data(), { now }).isMissing).toBe(false);
  });

  it("★ JST でまだ日付が変わっていなければ当日は赤くない", () => {
    // UTC 2026-10-15 14:59 = JST 2026-10-15 23:59
    const now = new Date("2026-10-15T14:59:00Z");
    expect(stateOf("2026-10-15", data(), { now }).isMissing).toBe(false);
  });

  it("★ 端末の時計（getDate など）を使っていない", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/attendance-calendar-cell-state.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/\.get(Date|Month|FullYear|Hours)\(/);
  });
});

describe("★ 休みの日の表示", () => {
  it("★ 休みの日は isLeave が立つ", () => {
    expect(stateOf("2026-10-20", data({ leaves: ["2026-10-20"] })).isLeave).toBe(true);
  });

  it("★ 休みの日に打刻があっても、休みの表示は出る", () => {
    const d = data({
      leaves: ["2026-10-14"],
      records: [{ id: "1", date: "2026-10-14", checkIn: "09:00", checkOut: "18:00" }],
    });
    const s = stateOf("2026-10-14", d);
    expect(s.isLeave).toBe(true);
    expect(s.hasPunch).toBe(true);
  });

  it("★ 休暇アプリが取得できないときは休みの表示を出さない（分からないため）", () => {
    expect(
      stateOf("2026-10-20", data({ leavesStatus: "error", leaves: null })).isLeave,
    ).toBe(false);
  });

  it("★ 前後の月のマスには休みの表示を出さない", () => {
    expect(
      stateOf("2026-09-30", data({ leaves: ["2026-09-30"] }), { inMonth: false }).isLeave,
    ).toBe(false);
  });

  it("★ 画面で休みのマスに表示を出している", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/components/attendance-month-calendar.tsx"),
      "utf8",
    );
    expect(src).toContain("buildAttendanceCellStates");
    expect(src).toMatch(/state\.isLeave \?/);
  });

  it("★ 凡例に休みと、赤いマスの説明がある（強い言葉は使わない）", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/components/attendance-month-calendar.tsx"),
      "utf8",
    );
    expect(src).toContain("休み");
    expect(src).toContain("打刻・休みの登録なし");
    expect(src).not.toContain("無断欠勤");
  });
});
