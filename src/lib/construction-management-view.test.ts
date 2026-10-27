import { describe, expect, it } from "vitest";

import {
  ALL_BRANCHES,
  ALL_KINDS,
  buildSundayStartMonthGrid,
  constructionManagementDebugSummary,
  countConstructionEvents,
  eventsOfDay,
  filterConstructionEvents,
  formatDayHeading,
  formatDetailDate,
  initialBranchSelection,
  isMyConstructionEvent,
  keepBranchSelection,
  KIND_META,
  MY_CASES,
  resolveConstructionManagementViewState,
  shiftYearMonth,
  summarizeEventsByDay,
} from "@/lib/construction-management-view";
import type {
  ConstructionManagementEvent,
  ConstructionManagementEventKind,
  ConstructionManagementPayload,
} from "@/lib/construction-management-view";

/** 施工管理タブの表示ロジック。氏名・T番号 は架空の値 */

let seq = 0;
function ev(
  kind: ConstructionManagementEventKind,
  dayKey: string,
  branches: string[],
  over: Partial<ConstructionManagementEvent> = {},
): ConstructionManagementEvent {
  seq += 1;
  return {
    id: `${kind}:${seq}`,
    kind,
    dayKey,
    customerName: `顧客${seq}`,
    tNumber: `T-${seq}`,
    branches,
    scaffoldContractor: "",
    scaffoldRequest: "",
    constructionContractor: "",
    customerMatched: true,
    duplicateConstructionTNumber: false,
    duplicateCustomerTNumber: false,
    dates: { scaffoldInstall: null, construction: null, scaffoldRemoval: null },
    ...over,
  };
}

function payload(
  over: Partial<ConstructionManagementPayload> = {},
): ConstructionManagementPayload {
  return {
    year: 2026,
    month: 11,
    events: [],
    counts: { scaffoldInstall: 0, scaffoldRemoval: 0, construction: 0, zanko: 0 },
    branches: ["支店A", "支店B"],
    selfWorkplace: null,
    duplicateTNumberGroups: { construction: 0, customer: 0 },
    correlationId: "cid",
    ...over,
  };
}

const AB = ev("scaffoldInstall", "2026-11-05", ["支店A", "支店B"]);
const A = ev("construction", "2026-11-05", ["支店A"]);
const B = ev("scaffoldRemoval", "2026-11-06", ["支店B"]);
const OTHER = ev("scaffoldInstall", "2026-11-07", ["その他"]);
const EVENTS = [AB, A, B, OTHER];

describe("支店の絞り込み", () => {
  it("★ AP か CL のどちらかの支店が一致する予定が残る", () => {
    expect(filterConstructionEvents(EVENTS, "支店A", ALL_KINDS)).toEqual([AB, A]);
    expect(filterConstructionEvents(EVENTS, "支店B", ALL_KINDS)).toEqual([AB, B]);
  });

  it("★ 「その他」で絞ると、その他の予定が残る", () => {
    expect(filterConstructionEvents(EVENTS, "その他", ALL_KINDS)).toEqual([OTHER]);
  });

  it("全支店なら絞らない", () => {
    expect(filterConstructionEvents(EVENTS, ALL_BRANCHES, ALL_KINDS)).toEqual(EVENTS);
  });

  it("支店ごとの件数を足すと全体より多くなる（1件が2支店に出る）", () => {
    const a = filterConstructionEvents(EVENTS, "支店A", ALL_KINDS).length;
    const b = filterConstructionEvents(EVENTS, "支店B", ALL_KINDS).length;
    const o = filterConstructionEvents(EVENTS, "その他", ALL_KINDS).length;
    expect(a + b + o).toBe(5);
    expect(EVENTS).toHaveLength(4);
  });
});

describe("区分の絞り込み", () => {
  it("★ その区分の予定だけが残る", () => {
    const only = new Set<ConstructionManagementEventKind>(["scaffoldInstall"]);
    expect(filterConstructionEvents(EVENTS, ALL_BRANCHES, only)).toEqual([AB, OTHER]);
  });

  it("複数選べる", () => {
    const two = new Set<ConstructionManagementEventKind>([
      "construction",
      "scaffoldRemoval",
    ]);
    expect(filterConstructionEvents(EVENTS, ALL_BRANCHES, two)).toEqual([A, B]);
  });

  it("支店と区分を同時に効かせる", () => {
    const only = new Set<ConstructionManagementEventKind>(["scaffoldInstall"]);
    expect(filterConstructionEvents(EVENTS, "支店B", only)).toEqual([AB]);
  });
});

describe("集計カードの件数", () => {
  it("★ 絞り込み後の件数を区分ごとに数える", () => {
    const filtered = filterConstructionEvents(EVENTS, "支店A", ALL_KINDS);
    expect(countConstructionEvents(filtered, ALL_KINDS)).toEqual({
      scaffoldInstall: 1,
      construction: 1,
      scaffoldRemoval: 0,
      zanko: 0,
    });
  });

  it("全支店・全区分なら API の counts と同じになる", () => {
    const api = { scaffoldInstall: 2, construction: 1, scaffoldRemoval: 1, zanko: 0 };
    const filtered = filterConstructionEvents(EVENTS, ALL_BRANCHES, ALL_KINDS);
    expect(countConstructionEvents(filtered, ALL_KINDS)).toEqual(api);
  });

  it("★ OFF の区分は null（カードは「—」）", () => {
    const kinds = new Set<ConstructionManagementEventKind>(["construction"]);
    const filtered = filterConstructionEvents(EVENTS, ALL_BRANCHES, kinds);
    expect(countConstructionEvents(filtered, kinds)).toEqual({
      scaffoldInstall: null,
      construction: 1,
      scaffoldRemoval: null,
      zanko: null,
    });
  });
});

describe("カレンダーのマス", () => {
  it("★ 同じ日・同じ区分は件数でまとめる。並びは設置 → 施工 → 解体", () => {
    const events = [
      ev("scaffoldRemoval", "2026-11-10", ["支店A"]),
      ev("scaffoldInstall", "2026-11-10", ["支店A"]),
      ev("scaffoldInstall", "2026-11-10", ["支店B"]),
      ev("construction", "2026-11-10", ["支店A"]),
      ev("scaffoldInstall", "2026-11-10", ["支店A"]),
      ev("construction", "2026-11-11", ["支店A"]),
    ];

    const byDay = summarizeEventsByDay(events);
    expect(byDay.get("2026-11-10")).toEqual([
      { kind: "scaffoldInstall", count: 3 },
      { kind: "construction", count: 1 },
      { kind: "scaffoldRemoval", count: 1 },
    ]);
    expect(byDay.get("2026-11-11")).toEqual([{ kind: "construction", count: 1 }]);
    expect(byDay.has("2026-11-12")).toBe(false);
  });

  it("区分ごとに文字ラベルを持つ（色だけで判断させない）", () => {
    expect(KIND_META.scaffoldInstall.shortLabel).toBe("設置");
    expect(KIND_META.scaffoldRemoval.shortLabel).toBe("解体");
    expect(KIND_META.construction.shortLabel).toBe("施工");
  });

  it("日曜始まり・7列で週がそろう", () => {
    // 2026年11月1日は日曜
    const grid = buildSundayStartMonthGrid(2026, 11);
    expect(grid.length % 7).toBe(0);
    expect(grid[0]).toEqual({ dayKey: "2026-11-01", inMonth: true, weekday: 0 });
    expect(grid.filter((c) => c.inMonth)).toHaveLength(30);
    // 2026年10月1日は木曜 → 前月の4日分で埋まる
    const oct = buildSundayStartMonthGrid(2026, 10);
    expect(oct.slice(0, 4).every((c) => !c.inMonth)).toBe(true);
    expect(oct[4]?.dayKey).toBe("2026-10-01");
  });

  it("前月・翌月（年をまたぐ）", () => {
    expect(shiftYearMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftYearMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });
});

describe("選択日の予定一覧", () => {
  it("★ 並びは 設置 → 施工 → 解体。同じ区分は API の順のまま、省略しない", () => {
    const r1 = ev("scaffoldRemoval", "2026-11-10", ["支店A"]);
    const i1 = ev("scaffoldInstall", "2026-11-10", ["支店A"]);
    const c1 = ev("construction", "2026-11-10", ["支店A"]);
    const i2 = ev("scaffoldInstall", "2026-11-10", ["支店A"]);
    const other = ev("construction", "2026-11-11", ["支店A"]);

    expect(eventsOfDay([r1, i1, c1, i2, other], "2026-11-10")).toEqual([
      i1,
      i2,
      c1,
      r1,
    ]);
  });

  it("日付が選ばれていなければ空", () => {
    expect(eventsOfDay(EVENTS, null)).toEqual([]);
  });

  it("見出しの日付（曜日つき）", () => {
    expect(formatDayHeading("2026-10-23")).toBe("10月23日（金）");
  });
});

describe("詳細表示", () => {
  it("★ 未登録の日付は「未定」", () => {
    expect(formatDetailDate(null)).toBe("未定");
    expect(formatDetailDate("")).toBe("未定");
    expect(formatDetailDate(undefined)).toBe("未定");
  });

  it("登録済みの日付は曜日つきで出す", () => {
    expect(formatDetailDate("2026-11-03")).toBe("2026年11月3日（火）");
  });
});

describe("支店フィルターの初期値", () => {
  it("本人の勤務場所が一覧にあればそれ", () => {
    expect(initialBranchSelection(payload({ selfWorkplace: "支店B" }))).toBe("支店B");
  });

  it("取得できない・一覧に無ければ全支店", () => {
    expect(initialBranchSelection(payload({ selfWorkplace: null }))).toBe(ALL_BRANCHES);
    expect(initialBranchSelection(payload({ selfWorkplace: "支店Z" }))).toBe(ALL_BRANCHES);
  });

  it("月を変えて選択中の支店が一覧から消えたら全支店に戻す", () => {
    expect(keepBranchSelection("その他", ["支店A"])).toBe(ALL_BRANCHES);
    expect(keepBranchSelection("支店A", ["支店A"])).toBe("支店A");
    expect(keepBranchSelection(ALL_BRANCHES, [])).toBe(ALL_BRANCHES);
  });
});

describe("画面の状態", () => {
  const ym = { year: 2026, month: 11 };

  it("★ 取得に失敗した状態と、予定が無い状態を別のものとして扱う", () => {
    const failed = resolveConstructionManagementViewState({
      data: undefined,
      error: new Error("施工管理のデータ取得に失敗しました（ID: abc）"),
      ym,
    });
    const empty = resolveConstructionManagementViewState({
      data: payload({ events: [] }),
      error: undefined,
      ym,
    });

    expect(failed).toEqual({
      kind: "error",
      message: "施工管理のデータ取得に失敗しました（ID: abc）",
    });
    expect(empty.kind).toBe("ready");
    if (empty.kind === "ready") expect(empty.payload.events).toEqual([]);
  });

  it("失敗したら、前のデータが残っていてもエラーを優先する", () => {
    const s = resolveConstructionManagementViewState({
      data: payload(),
      error: new Error("x"),
      ym,
    });
    expect(s.kind).toBe("error");
  });

  it("月を切り替えた直後に前の月のデータが残っていたら、取得中として扱う", () => {
    const s = resolveConstructionManagementViewState({
      data: payload({ month: 10 }),
      error: undefined,
      ym,
    });
    expect(s).toEqual({ kind: "loading" });
  });

  it("まだ何も無ければ取得中", () => {
    expect(
      resolveConstructionManagementViewState({ data: undefined, error: undefined, ym }),
    ).toEqual({ kind: "loading" });
  });
});

describe("デバッグ用の要点", () => {
  it("件数と真偽値だけで、氏名・T番号 を含めない", () => {
    const state = resolveConstructionManagementViewState({
      data: payload({ events: EVENTS, selfWorkplace: "支店A" }),
      error: undefined,
      ym: { year: 2026, month: 11 },
    });
    const text = JSON.stringify(
      constructionManagementDebugSummary(state, { year: 2026, month: 11 }),
    );
    expect(text).toContain('"events":4');
    expect(text).not.toContain("顧客");
    expect(text).not.toContain("T-");
    expect(text).not.toContain("支店A");
  });
});

describe("自分の案件のみ", () => {
  const ME = "担当 自分";
  const apMine = ev("scaffoldInstall", "2026-11-05", ["支店A"], {
    apStaffNames: [ME],
    clStaffNames: ["担当 他"],
  });
  const clMine = ev("construction", "2026-11-06", ["支店B"], {
    apStaffNames: ["担当 他"],
    clStaffNames: [ME],
  });
  const notMine = ev("scaffoldRemoval", "2026-11-07", ["支店A"], {
    apStaffNames: ["担当 他"],
    clStaffNames: ["担当 別"],
  });
  const noStaff = ev("construction", "2026-11-08", ["その他"]);
  const MINE_EVENTS = [apMine, clMine, notMine, noStaff];

  it("★ AP が自分の予定が残る", () => {
    expect(filterConstructionEvents(MINE_EVENTS, MY_CASES, ALL_KINDS, ME)).toContain(apMine);
  });

  it("★ CL が自分の予定が残る", () => {
    expect(filterConstructionEvents(MINE_EVENTS, MY_CASES, ALL_KINDS, ME)).toContain(clMine);
  });

  it("★ AP も CL も自分でない予定は除く（担当者の欄が無い予定も）", () => {
    expect(filterConstructionEvents(MINE_EVENTS, MY_CASES, ALL_KINDS, ME)).toEqual([
      apMine,
      clMine,
    ]);
  });

  it("★ 前後に空白があっても一致する", () => {
    expect(isMyConstructionEvent(apMine, `  ${ME}　`)).toBe(true);
    const padded = ev("construction", "2026-11-09", ["支店A"], {
      apStaffNames: [` ${ME} `],
    });
    expect(isMyConstructionEvent(padded, ME)).toBe(true);
  });

  it("★ 全角半角・空白の違いがあっても一致する", () => {
    const e = ev("construction", "2026-11-09", ["支店A"], {
      apStaffNames: ["ﾀﾝﾄｳ　Ａ"],
    });
    expect(isMyConstructionEvent(e, "タントウ A")).toBe(true);
    expect(isMyConstructionEvent(e, "タントウ B")).toBe(false);
  });

  it("自分の氏名が無ければ、どの予定も自分の案件にしない", () => {
    expect(filterConstructionEvents(MINE_EVENTS, MY_CASES, ALL_KINDS, null)).toEqual([]);
    expect(isMyConstructionEvent(apMine, "  ")).toBe(false);
  });

  it("★ 絞り込み後の件数（区分の絞り込みとも組み合わさる）", () => {
    const mine = filterConstructionEvents(MINE_EVENTS, MY_CASES, ALL_KINDS, ME);
    expect(countConstructionEvents(mine, ALL_KINDS)).toEqual({
      scaffoldInstall: 1,
      construction: 1,
      scaffoldRemoval: 0,
      zanko: 0,
    });

    const onlyInstall = new Set<ConstructionManagementEventKind>(["scaffoldInstall"]);
    const mineInstall = filterConstructionEvents(MINE_EVENTS, MY_CASES, onlyInstall, ME);
    expect(countConstructionEvents(mineInstall, onlyInstall)).toEqual({
      scaffoldInstall: 1,
      construction: null,
      scaffoldRemoval: null,
      zanko: null,
    });
  });

  it("★ 初期表示: 氏名が取れれば「自分の案件のみ」", () => {
    expect(
      initialBranchSelection(payload({ selfStaffName: ME, selfWorkplace: "支店A" })),
    ).toBe(MY_CASES);
  });

  it("★ 初期表示: 氏名が取れなければ勤務場所", () => {
    expect(
      initialBranchSelection(payload({ selfStaffName: null, selfWorkplace: "支店B" })),
    ).toBe("支店B");
    expect(
      initialBranchSelection(payload({ selfStaffName: "  ", selfWorkplace: "支店B" })),
    ).toBe("支店B");
  });

  it("★ 初期表示: 勤務場所も取れなければ全支店", () => {
    expect(
      initialBranchSelection(payload({ selfStaffName: null, selfWorkplace: null })),
    ).toBe(ALL_BRANCHES);
  });

  it("★ 自分の案件が0件でも、初期表示は「自分の案件のみ」のまま", () => {
    const p = payload({ selfStaffName: ME, events: [notMine, noStaff] });
    const initial = initialBranchSelection(p);
    expect(initial).toBe(MY_CASES);
    expect(filterConstructionEvents(p.events, initial, ALL_KINDS, ME)).toEqual([]);
  });

  it("月を変えても、氏名が取れている間は「自分の案件のみ」のまま", () => {
    expect(keepBranchSelection(MY_CASES, [], true)).toBe(MY_CASES);
    expect(keepBranchSelection(MY_CASES, ["支店A"], false)).toBe(ALL_BRANCHES);
  });
});
