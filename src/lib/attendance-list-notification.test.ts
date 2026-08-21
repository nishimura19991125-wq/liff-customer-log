import { describe, expect, it } from "vitest";

import {
  ATTENDANCE_LIST_NO_DEPARTMENT_LABEL,
  buildAttendanceClockInListMessage,
  buildAttendanceListSections,
  buildMissingClockOutListMessage,
  formatAttendanceListDate,
  formatAttendanceListNumber,
} from "@/lib/attendance-list-notification";

/**
 * タスクY: 定時リストの本文。
 *
 * 設定を足さずに運用できることを見る。部署が増えても、⑳を超えても、
 * 部署が未設定の人が現れても、文面が壊れないこと。
 */

const ROSTER_ORDER = ["DC事業部", "DX事業部", "経理部"];

describe("★ ① 出勤者リストの本文", () => {
  it("指定の書式で組み立てる", () => {
    const text = buildAttendanceClockInListMessage({
      workDate: "2026-08-21",
      departmentOrder: ROSTER_ORDER,
      people: [
        { staffName: "丸山龍生", department: "DC事業部" },
        { staffName: "岩田陽紀", department: "DC事業部" },
        { staffName: "阪本遥", department: "DC事業部" },
        { staffName: "西村直也", department: "DX事業部" },
        { staffName: "冨田菜摘", department: "DX事業部" },
        { staffName: "秋山直道", department: "経理部" },
      ],
    });

    expect(text).toBe(
      [
        "▼本日の出勤者▼",
        "8/21（金）",
        "----------------",
        "【DC事業部】",
        "①丸山龍生",
        "②岩田陽紀",
        "③阪本遥",
        "----------------",
        "【DX事業部】",
        "①西村直也",
        "②冨田菜摘",
        "----------------",
        "【経理部】",
        "①秋山直道",
      ].join("\n"),
    );
  });

  it("★ 時刻は含めない", () => {
    const text = buildAttendanceClockInListMessage({
      workDate: "2026-08-21",
      departmentOrder: ROSTER_ORDER,
      people: [{ staffName: "西村直也", department: "DX事業部" }],
    });

    expect(text).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("番号は部署ごとに①へ戻る", () => {
    const text = buildAttendanceClockInListMessage({
      workDate: "2026-08-21",
      departmentOrder: ROSTER_ORDER,
      people: [
        { staffName: "A", department: "DC事業部" },
        { staffName: "B", department: "DX事業部" },
      ],
    });

    expect(text).toContain("①A");
    expect(text).toContain("①B");
  });
});

describe("★ ② 未退勤リストの本文", () => {
  it("出勤者リストと同じ形式で組み立てる", () => {
    const text = buildMissingClockOutListMessage({
      workDate: "2026-08-21",
      attendeeCount: 12,
      departmentOrder: ROSTER_ORDER,
      people: [
        { staffName: "西村直也", department: "DX事業部" },
        { staffName: "丸山龍生", department: "DC事業部" },
      ],
    });

    expect(text).toBe(
      [
        "▼退勤打刻もれ▼",
        "8/21（金）",
        "以下の方は退勤打刻がされていません。",
        "----------------",
        "【DC事業部】",
        "①丸山龍生",
        "----------------",
        "【DX事業部】",
        "①西村直也",
      ].join("\n"),
    );
  });
});

describe("★ ③ 対象者が0人のとき", () => {
  it("出勤者0人なら送らない（null）", () => {
    expect(
      buildAttendanceClockInListMessage({
        workDate: "2026-08-21",
        departmentOrder: ROSTER_ORDER,
        people: [],
      }),
    ).toBeNull();
  });

  it("未退勤0人なら「全員が退勤打刻済みです」を送る", () => {
    const text = buildMissingClockOutListMessage({
      workDate: "2026-08-21",
      attendeeCount: 12,
      departmentOrder: ROSTER_ORDER,
      people: [],
    });

    expect(text).toBe(
      [
        "▼退勤打刻もれ▼",
        "8/21（金）",
        "----------------",
        "全員が退勤打刻済みです",
      ].join("\n"),
    );
  });

  it("★ その日の出勤者自体が0人なら、未退勤リストも送らない", () => {
    expect(
      buildMissingClockOutListMessage({
        workDate: "2026-08-22",
        attendeeCount: 0,
        departmentOrder: ROSTER_ORDER,
        people: [],
      }),
    ).toBeNull();
  });
});

describe("★ ④ 部署の並び順は名簿の登録順", () => {
  it("出勤順ではなく名簿の順に並べる", () => {
    const sections = buildAttendanceListSections(
      [
        { staffName: "秋山", department: "経理部" },
        { staffName: "西村", department: "DX事業部" },
        { staffName: "丸山", department: "DC事業部" },
      ],
      ROSTER_ORDER,
    );

    expect(sections.map((s) => s.department)).toEqual([
      "DC事業部",
      "DX事業部",
      "経理部",
    ]);
  });

  it("★ 名簿に無い部署は出勤者に現れた順で後ろに続く", () => {
    const sections = buildAttendanceListSections(
      [
        { staffName: "新人", department: "新規事業部" },
        { staffName: "丸山", department: "DC事業部" },
        { staffName: "別", department: "品質管理部" },
      ],
      ROSTER_ORDER,
    );

    expect(sections.map((s) => s.department)).toEqual([
      "DC事業部",
      "新規事業部",
      "品質管理部",
    ]);
  });

  it("名簿の順が引けなくても全員出る", () => {
    const sections = buildAttendanceListSections(
      [
        { staffName: "西村", department: "DX事業部" },
        { staffName: "丸山", department: "DC事業部" },
      ],
      [],
    );

    expect(sections.map((s) => s.department)).toEqual([
      "DX事業部",
      "DC事業部",
    ]);
    expect(sections.flatMap((s) => s.names)).toEqual(["西村", "丸山"]);
  });
});

describe("★ ⑤ 部署が未設定の人も必ず表示する", () => {
  it("「部署なし」でまとめ、末尾に置く", () => {
    const text = buildAttendanceClockInListMessage({
      workDate: "2026-08-21",
      departmentOrder: ROSTER_ORDER,
      people: [
        { staffName: "名無し1" },
        { staffName: "丸山龍生", department: "DC事業部" },
        { staffName: "名無し2", department: "   " },
      ],
    });

    expect(text).toBe(
      [
        "▼本日の出勤者▼",
        "8/21（金）",
        "----------------",
        "【DC事業部】",
        "①丸山龍生",
        "----------------",
        `【${ATTENDANCE_LIST_NO_DEPARTMENT_LABEL}】`,
        "①名無し1",
        "②名無し2",
      ].join("\n"),
    );
  });

  it("全員が部署未設定でも送る", () => {
    const text = buildAttendanceClockInListMessage({
      workDate: "2026-08-21",
      people: [{ staffName: "名無し" }],
    });

    expect(text).toContain(`【${ATTENDANCE_LIST_NO_DEPARTMENT_LABEL}】`);
    expect(text).toContain("①名無し");
  });
});

describe("★ ⑥ 番号は人数に応じて自動で切り替わる", () => {
  it("1〜20 は丸数字", () => {
    expect(formatAttendanceListNumber(1)).toBe("①");
    expect(formatAttendanceListNumber(10)).toBe("⑩");
    expect(formatAttendanceListNumber(20)).toBe("⑳");
  });

  it("★ 21 以降は通常の数字", () => {
    expect(formatAttendanceListNumber(21)).toBe("21.");
    expect(formatAttendanceListNumber(35)).toBe("35.");
  });

  it("⑳ を超える部署でも設定なしで並ぶ", () => {
    const people = Array.from({ length: 22 }, (_, i) => ({
      staffName: `社員${i + 1}`,
      department: "DC事業部",
    }));

    const text = buildAttendanceClockInListMessage({
      workDate: "2026-08-21",
      departmentOrder: ROSTER_ORDER,
      people,
    });

    expect(text).toContain("⑳社員20");
    expect(text).toContain("21.社員21");
    expect(text).toContain("22.社員22");
    // 全員分の行がある（見出し2行 + 区切り1行 + 部署見出し1行 + 22名）
    expect(text?.split("\n")).toHaveLength(26);
  });
});

describe("★ 日付の表記", () => {
  it("月日と曜日を出す", () => {
    expect(formatAttendanceListDate("2026-08-21")).toBe("8/21（金）");
    expect(formatAttendanceListDate("2026-08-22")).toBe("8/22（土）");
    expect(formatAttendanceListDate("2026-01-01")).toBe("1/1（木）");
  });

  it("読めない値はそのまま返す（本文を壊さない）", () => {
    expect(formatAttendanceListDate("")).toBe("");
    expect(formatAttendanceListDate("2026/08/21")).toBe("2026/08/21");
  });
});
