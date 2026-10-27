import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  isRestLeaveType,
  leaveTypeLabel,
  leaveTypeMark,
  normalizeLeaveType,
  pickLeaveTypeForDay,
} from "@/lib/leave-type-mark";

/**
 * 休暇種別 → 印、の対応表と、同じ日に複数あるときの選び方。
 * カレンダーと休暇登録画面の両方がここを使う。
 */

describe("★ 種別ごとの印", () => {
  it("★ 4種別の印", () => {
    expect(leaveTypeMark("休み")).toBe("休");
    expect(leaveTypeMark("有給")).toBe("有");
    expect(leaveTypeMark("忌引き")).toBe("忌");
    expect(leaveTypeMark("欠勤")).toBe("欠");
  });

  it("★ 知らない種別は1文字目", () => {
    expect(leaveTypeMark("特別休暇")).toBe("特");
    expect(leaveTypeMark("代休")).toBe("代");
  });

  it("★ 空なら「休」", () => {
    expect(leaveTypeMark("")).toBe("休");
    expect(leaveTypeMark(null)).toBe("休");
    expect(leaveTypeMark(undefined)).toBe("休");
  });

  it("★ 正規化したあとに空になったら「休」（空白だけ・全角空白だけ）", () => {
    expect(leaveTypeMark("   ")).toBe("休");
    expect(leaveTypeMark("　　")).toBe("休");
  });

  it("★ 前後の空白や全角半角の違いをならしてから当てる", () => {
    expect(leaveTypeMark(" 有給　")).toBe("有");
    expect(normalizeLeaveType("　忌引き ")).toBe("忌引き");
    // 半角カナも全角にそろう（知らない種別の1文字目も、ならしたあとの文字）
    expect(leaveTypeMark("ﾄｸﾍﾞﾂ")).toBe("ト");
  });

  it("★ 1文字目はサロゲートペアでも壊れない", () => {
    expect(leaveTypeMark("𠮷休")).toBe("𠮷");
  });

  it("種別の名前（空なら「休み」）", () => {
    expect(leaveTypeLabel("有給")).toBe("有給");
    expect(leaveTypeLabel(" ")).toBe("休み");
  });
});

describe("★ 「休み」かどうか（週2日の制限で数えるのは休みだけ）", () => {
  it("★ 休みと空は休み、それ以外は休みではない", () => {
    expect(isRestLeaveType("休み")).toBe(true);
    expect(isRestLeaveType(" 休み ")).toBe(true);
    expect(isRestLeaveType("")).toBe(true);
    for (const t of ["有給", "忌引き", "欠勤", "特別休暇"]) {
      expect(isRestLeaveType(t)).toBe(false);
    }
  });
});

describe("★ 同じ日に複数あるとき（忌引き > 欠勤 > 有給 > 知らない種別 > 休み）", () => {
  const r = (type: string, recordId: string | null) => ({ type, recordId });

  it("★ 決めた順位で1つ選ぶ", () => {
    expect(pickLeaveTypeForDay([r("休み", "1"), r("有給", "2")])).toBe("有給");
    expect(pickLeaveTypeForDay([r("有給", "1"), r("欠勤", "2")])).toBe("欠勤");
    expect(pickLeaveTypeForDay([r("欠勤", "1"), r("忌引き", "2")])).toBe("忌引き");
    expect(pickLeaveTypeForDay([r("忌引き", "9"), r("休み", "1"), r("有給", "2"), r("欠勤", "3")])).toBe(
      "忌引き",
    );
  });

  it("★ 知らない種別は有給より下、休みより上", () => {
    expect(pickLeaveTypeForDay([r("休み", "1"), r("特別休暇", "2")])).toBe("特別休暇");
    expect(pickLeaveTypeForDay([r("特別休暇", "1"), r("有給", "2")])).toBe("有給");
  });

  it("★ 同じ順位なら先に登録されたほう（レコードIDの小さいほう）", () => {
    expect(pickLeaveTypeForDay([r("代休", "12"), r("特別休暇", "3")])).toBe("特別休暇");
    // 数字として比べる（文字列なら "12" < "3" になってしまう）
    expect(pickLeaveTypeForDay([r("代休", "3"), r("特別休暇", "12")])).toBe("代休");
  });

  it("空の種別は休みと同じ順位", () => {
    expect(pickLeaveTypeForDay([r("", "1"), r("有給", "2")])).toBe("有給");
  });

  it("選んだ種別は正規化したもの", () => {
    expect(pickLeaveTypeForDay([r(" 有給　", "1")])).toBe("有給");
  });
});

describe("★ 勤怠カレンダーの見せ方", () => {
  it("★ 休暇のある日は、種別にかかわらず赤いマスにならない", async () => {
    const { buildAttendanceCellStates } = await import("@/lib/attendance-calendar-cell-state");
    const now = new Date("2026-10-28T03:00:00Z"); // JST 10/28
    const leaveTypes: Record<string, string> = {
      "2026-10-05": "休み",
      "2026-10-06": "有給",
      "2026-10-07": "忌引き",
      "2026-10-08": "欠勤",
      "2026-10-09": "特別休暇",
      "2026-10-13": "",
    };
    const data = {
      year: 2026,
      month: 10,
      records: [],
      recordsComplete: true,
      leaves: Object.keys(leaveTypes),
      leaveTypes,
      leavesStatus: "ok" as const,
    };
    const cells = Object.keys(leaveTypes).map((dateKey) => ({ dateKey, inMonth: true }));
    const states = buildAttendanceCellStates(cells, data, 2026, 10, now);
    for (const d of Object.keys(leaveTypes)) {
      expect(states.get(d)!.isLeave).toBe(true);
      expect(states.get(d)!.isMissing).toBe(false);
    }
  });

  it("★ カレンダーは対応表で印を出し、4種別とも同じ灰色", () => {
    const src = readFileSync("src/components/attendance-month-calendar.tsx", "utf8");
    expect(src).toContain("leaveTypeMark");
    expect(src).toContain("leaveTypes");
    expect(src).toContain("休暇（休・有・忌・欠）");
    // 休暇の色は水色から灰色へ。赤いマス（rose）とは別の色
    expect(src).not.toMatch(/bg-sky-500[^"]*">\s*休\s*</);
    expect(src).toContain("LEAVE_CELL_CLASS");
    expect(src).toContain("LEAVE_BADGE_CLASS");
  });
});
