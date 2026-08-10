import { describe, expect, it } from "vitest";

import type { CalendarMonthApiItem } from "@/lib/calendar-api-types";
import {
  CALENDAR_UNSET_CONTRACTOR_KEY,
  calendarContractorLabel,
  collectCalendarContractors,
  countCalendarItems,
  filterCalendarByDay,
  formatCalendarEmptySlotSummary,
  summarizeCalendarEmptySlots,
} from "@/lib/calendar-contractor-filter";
import { formatMonthDayWithWeekday } from "@/lib/format-weekday-date";

function item(
  category: "empty" | "list",
  contractorKey: string,
): CalendarMonthApiItem {
  return {
    line1: "",
    line2: "",
    memo: "",
    reportKankoComplete: false,
    showKankoCheck: false,
    postponedBadge: false,
    segmentShort: "",
    housingShort: "",
    category,
    contractorKey,
    recordId: null,
    accessEditUrl: "",
    pinpointAddress: "",
    normalAddress: "",
  };
}

/** 2026-09 の想定。today は 9/10 */
const TODAY = "2026-09-10";

const BY_DAY = {
  "2026-09-05": [item("empty", "A社"), item("list", "B社")],
  "2026-09-12": [item("empty", "A社"), item("empty", "B社")],
  "2026-09-15": [item("empty", "A社"), item("list", "A社")],
  "2026-09-20": [item("empty", CALENDAR_UNSET_CONTRACTOR_KEY)],
  "2026-09-25": [item("list", "C社")],
};

describe("collectCalendarContractors", () => {
  it("表示中の月に出ている施工会社だけを名前順で返す", () => {
    expect(collectCalendarContractors(BY_DAY)).toEqual([
      "A社",
      "B社",
      "C社",
      CALENDAR_UNSET_CONTRACTOR_KEY,
    ]);
  });

  it("未設定は最後に置く", () => {
    const list = collectCalendarContractors({
      "2026-09-01": [item("empty", CALENDAR_UNSET_CONTRACTOR_KEY)],
      "2026-09-02": [item("empty", "Z社")],
    });
    expect(list).toEqual(["Z社", CALENDAR_UNSET_CONTRACTOR_KEY]);
  });

  it("データが無ければ空", () => {
    expect(collectCalendarContractors({})).toEqual([]);
    expect(collectCalendarContractors(undefined)).toEqual([]);
  });

  it("未設定のラベルは「未設定」", () => {
    expect(calendarContractorLabel(CALENDAR_UNSET_CONTRACTOR_KEY)).toBe(
      "未設定",
    );
    expect(calendarContractorLabel("A社")).toBe("A社");
  });
});

describe("filterCalendarByDay", () => {
  const all = new Set(["A社", "B社", "C社", CALENDAR_UNSET_CONTRACTOR_KEY]);

  it("初期状態（全社・すべて）では件数が変わらない", () => {
    const filtered = filterCalendarByDay(BY_DAY, {
      selectedContractors: all,
      mode: "all",
    });
    expect(countCalendarItems(filtered)).toBe(countCalendarItems(BY_DAY));
  });

  it("施工店フィルタは空き枠と案件の両方に効く", () => {
    const filtered = filterCalendarByDay(BY_DAY, {
      selectedContractors: new Set(["A社"]),
      mode: "all",
    });
    const kinds = Object.values(filtered)
      .flat()
      .map((i) => `${i.contractorKey}:${i.category}`);
    expect(kinds).toEqual([
      "A社:empty",
      "A社:empty",
      "A社:empty",
      "A社:list",
    ]);
  });

  it("空き枠のみ", () => {
    const filtered = filterCalendarByDay(BY_DAY, {
      selectedContractors: all,
      mode: "empty",
    });
    expect(
      Object.values(filtered)
        .flat()
        .every((i) => i.category === "empty"),
    ).toBe(true);
    expect(countCalendarItems(filtered)).toBe(5);
  });

  it("工事日のみ", () => {
    const filtered = filterCalendarByDay(BY_DAY, {
      selectedContractors: all,
      mode: "list",
    });
    expect(
      Object.values(filtered)
        .flat()
        .every((i) => i.category === "list"),
    ).toBe(true);
    expect(countCalendarItems(filtered)).toBe(3);
  });

  it("施工店フィルタと表示モードが同時に効く", () => {
    const filtered = filterCalendarByDay(BY_DAY, {
      selectedContractors: new Set(["A社", "B社"]),
      mode: "empty",
    });
    expect(Object.keys(filtered).sort()).toEqual([
      "2026-09-05",
      "2026-09-12",
      "2026-09-15",
    ]);
    expect(countCalendarItems(filtered)).toBe(4);
  });

  it("全社のチェックを外すと何も残らない", () => {
    const filtered = filterCalendarByDay(BY_DAY, {
      selectedContractors: new Set(),
      mode: "all",
    });
    expect(filtered).toEqual({});
  });

  it("元の byDay を書き換えない", () => {
    const before = JSON.stringify(BY_DAY);
    filterCalendarByDay(BY_DAY, {
      selectedContractors: new Set(["A社"]),
      mode: "empty",
    });
    expect(JSON.stringify(BY_DAY)).toBe(before);
  });
});

describe("summarizeCalendarEmptySlots", () => {
  const summaries = summarizeCalendarEmptySlots(BY_DAY, { todayKey: TODAY });
  const byKey = new Map(summaries.map((s) => [s.contractorKey, s]));

  it("施工店ごとに空き枠を集計する", () => {
    expect(byKey.get("A社")?.count).toBe(3);
    expect(byKey.get("B社")?.count).toBe(1);
  });

  it("割り当て済み（list）は件数に含まない", () => {
    // C社は list のみ。空き枠が無いので一覧に出ない
    expect(byKey.has("C社")).toBe(false);
    // A社は list が1件あるが、count は empty の3件だけ
    expect(byKey.get("A社")?.count).toBe(3);
  });

  it("過去日は最短日から除外する（件数には残る）", () => {
    // A社の空き枠は 9/5・9/12・9/15。today=9/10 なので最短は 9/12
    expect(byKey.get("A社")?.earliestDayKey).toBe("2026-09-12");
    expect(byKey.get("A社")?.count).toBe(3);
  });

  it("当日は最短日に含める", () => {
    const s = summarizeCalendarEmptySlots(
      { "2026-09-10": [item("empty", "A社")] },
      { todayKey: TODAY },
    );
    expect(s[0]?.earliestDayKey).toBe("2026-09-10");
  });

  it("過去の月では最短日が出ない", () => {
    const s = summarizeCalendarEmptySlots(
      {
        "2026-08-05": [item("empty", "A社")],
        "2026-08-20": [item("empty", "A社")],
      },
      { todayKey: TODAY },
    );
    expect(s[0]?.count).toBe(2);
    expect(s[0]?.earliestDayKey).toBeNull();
    expect(s[0]?.earliestLabel).toBe("");
  });

  it("施工会社が未設定のレコードも1つの項目として集計する", () => {
    const unset = byKey.get(CALENDAR_UNSET_CONTRACTOR_KEY);
    expect(unset?.count).toBe(1);
    expect(unset?.label).toBe("未設定");
    expect(unset?.earliestDayKey).toBe("2026-09-20");
  });

  it("contractorKeys を渡すと 0 件の施工店も並べられる", () => {
    const s = summarizeCalendarEmptySlots(BY_DAY, {
      todayKey: TODAY,
      contractorKeys: ["A社", "C社"],
    });
    expect(s.map((x) => [x.contractorKey, x.count])).toEqual([
      ["A社", 3],
      ["C社", 0],
    ]);
  });

  it("最短日の表記はゼロ埋めなし・曜日つき", () => {
    // 2026-09-12 は土曜
    expect(byKey.get("A社")?.earliestLabel).toBe("9/12(土)");
    expect(formatMonthDayWithWeekday("2026-09-05")).toBe("9/5(土)");
    expect(formatMonthDayWithWeekday("2026-10-01")).toBe("10/1(木)");
  });
});

describe("formatCalendarEmptySlotSummary", () => {
  it("0件のときは「残りなし」で最短日を出さない", () => {
    expect(
      formatCalendarEmptySlotSummary({
        contractorKey: "C社",
        label: "C社",
        count: 0,
        earliestDayKey: null,
        earliestLabel: "",
      }),
    ).toBe("残りなし");
  });

  it("件数と最短日を並べる", () => {
    expect(
      formatCalendarEmptySlotSummary({
        contractorKey: "A社",
        label: "A社",
        count: 12,
        earliestDayKey: "2026-09-05",
        earliestLabel: "9/5(土)",
      }),
    ).toBe("残り12件 / 最短 9/5(土)");
  });

  it("最短日が無い（過去の月）ときは件数だけ", () => {
    expect(
      formatCalendarEmptySlotSummary({
        contractorKey: "A社",
        label: "A社",
        count: 2,
        earliestDayKey: null,
        earliestLabel: "",
      }),
    ).toBe("残り2件");
  });
});
