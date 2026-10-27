import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { CalendarMonthApiItem } from "@/lib/calendar-api-types";
import { filterCalendarByDay } from "@/lib/calendar-contractor-filter";
import { buildCalendarPayload } from "@/lib/calendar-kojo";
import { buildContractRecordMap } from "@/lib/contract-records";
import { buildZankoCaseEntries } from "@/lib/zanko-cards";
import { buildZankoIndex } from "@/lib/zanko-index";

/**
 * 工事カレンダーの【延期】とグレー（残工 段階3）。
 */

const F = {
  name: "field-1",
  contractor: "field-2",
  start: "field-3",
  end: "field-4",
  housing: "field-5",
  t: "field-6",
  shigumi: "field-7",
  panel: "field-8",
};

const CONSTRUCTION_FIELDS = [
  { uniqueId: F.name, caption: "お客様名" },
  { uniqueId: F.contractor, caption: "施工会社" },
  { uniqueId: F.start, caption: "施工予定日" },
  { uniqueId: F.end, caption: "終了日" },
  { uniqueId: F.housing, caption: "住宅ステータス" },
  { uniqueId: F.t, caption: "T番号" },
  { uniqueId: F.shigumi, caption: "仕込日" },
  { uniqueId: F.panel, caption: "パネル工事日" },
];

const REPORT_FIELDS = [
  { uniqueId: "r-1", caption: "T番号" },
  { uniqueId: "r-2", caption: "報告内容" },
];

function payload(opts: {
  zankoRows?: Array<[string, string]>;
  construction?: Array<Record<string, unknown>>;
  /** null で「工事報告を読めていない」 */
  reports?: Array<Record<string, unknown>> | null;
  year?: number;
  month?: number;
}) {
  const year = opts.year ?? 2026;
  const month = opts.month ?? 11;
  const index = buildZankoIndex(
    (opts.zankoRows ?? []).map(([t, d], i) => ({
      recordId: i + 1,
      record: { "z-3": t, "z-7": d },
    })),
    { tNumberFieldId: "z-3", dateFieldId: "z-7" },
  );
  const reports = opts.reports === undefined ? [] : opts.reports;
  return buildCalendarPayload(
    year,
    month,
    (opts.construction ?? []).map((record, i) => ({ recordId: 100 + i, record })),
    reports === null ? null : reports.map((record, i) => ({ recordId: 900 + i, record })),
    CONSTRUCTION_FIELDS,
    reports === null ? null : REPORT_FIELDS,
    {
      zankoIndex: index,
      zankoEntries: buildZankoCaseEntries(
        index,
        buildContractRecordMap([]),
        year,
        month,
      ),
    },
  );
}

const KICHIKU = {
  [F.name]: "山田 太郎",
  [F.start]: "2026-11-05",
  [F.end]: "2026-11-06",
  [F.housing]: "既築案件",
  [F.t]: "T0001",
  [F.contractor]: "株式会社アルファ",
};

const SHINCHIKU = {
  [F.name]: "鈴木 一郎",
  [F.housing]: "新築案件",
  [F.t]: "T0002",
  [F.shigumi]: "2026-11-03",
  [F.panel]: "2026-11-20",
  [F.contractor]: "株式会社ベータ",
};

function cases(day: CalendarMonthApiItem[] | undefined) {
  return (day ?? []).filter((i) => !i.zanko);
}

describe("【延期】の印", () => {
  it("★ 186 に T番号 があれば付く・1行目は【延期】お客様名様", () => {
    const p = payload({ zankoRows: [["T0001", "2026-12-01"]], construction: [KICHIKU] });

    for (const day of ["2026-11-05", "2026-11-06"]) {
      const item = cases(p.byDay[day])[0];
      expect(item?.line1).toBe("【延期】山田 太郎様");
      expect(item?.postponedBadge).toBe(true);
    }
  });

  it("★ 残工日が空でも付く", () => {
    const p = payload({ zankoRows: [["T0001", ""]], construction: [KICHIKU] });
    expect(cases(p.byDay["2026-11-05"])[0]?.line1).toBe("【延期】山田 太郎様");
  });

  it("★ T番号 は NFKC でそろえて突き合わせる", () => {
    const p = payload({
      zankoRows: [["T0001", ""]],
      construction: [{ ...KICHIKU, [F.t]: "Ｔ０００１" }],
    });
    expect(cases(p.byDay["2026-11-05"])[0]?.postponedBadge).toBe(true);
  });

  it("★ 186 に無ければ付かない・グレーにもしない", () => {
    const p = payload({ zankoRows: [["T0009", ""]], construction: [KICHIKU] });
    const item = cases(p.byDay["2026-11-05"])[0];
    expect(item?.line1).toBe("山田 太郎様");
    expect(item?.postponedBadge).toBe(false);
    expect(item?.gray).toBeFalsy();
  });

  it("★ 新築案件・産業用案件には付かない（1行目は【区分】お客様名様のまま）", () => {
    for (const housing of ["新築案件", "産業用案件"]) {
      const p = payload({
        zankoRows: [["T0002", ""]],
        construction: [{ ...SHINCHIKU, [F.housing]: housing }],
      });
      const item = cases(p.byDay["2026-11-03"])[0];
      expect(item?.line1).toBe("【仕込工事】鈴木 一郎様");
      expect(item?.postponedBadge).toBe(false);
    }
  });

  it("★ 【残工】カードには付かない", () => {
    const p = payload({ zankoRows: [["T0001", "2026-11-12"]], construction: [KICHIKU] });
    const z = p.byDay["2026-11-12"]?.find((i) => i.zanko);
    expect(z?.line1).toBe("【残工】");
    expect(z?.postponedBadge).toBe(false);
  });
});

describe("グレー", () => {
  it("★ 【延期】案件のカードは全部グレー（最新日より後でも）", () => {
    const p = payload({
      zankoRows: [["T0001", "2026-10-01"]],
      construction: [KICHIKU],
    });
    expect(cases(p.byDay["2026-11-05"])[0]?.gray).toBe(true);
    expect(cases(p.byDay["2026-11-06"])[0]?.gray).toBe(true);
  });

  it("★ 新築・産業用は、最新の残工日より前の工程がグレー・後の工程はグレーにしない", () => {
    const p = payload({
      zankoRows: [["T0002", "2026-11-10"]],
      construction: [SHINCHIKU],
    });
    expect(cases(p.byDay["2026-11-03"])[0]?.gray).toBe(true);
    expect(cases(p.byDay["2026-11-20"])[0]?.gray).toBeFalsy();
  });

  it("★ 最新日の判定に残工日が入る（残工日が後なら、後の工程もグレー）", () => {
    const p = payload({
      zankoRows: [
        ["T0002", "2026-11-10"],
        ["T0002", "2026-11-25"],
      ],
      construction: [SHINCHIKU],
    });
    expect(cases(p.byDay["2026-11-20"])[0]?.gray).toBe(true);
  });

  it("★ 完了報告がある工程はグレーにしない（✅ と同じ判定）", () => {
    const p = payload({
      zankoRows: [["T0002", "2026-11-25"]],
      construction: [SHINCHIKU],
      reports: [{ "r-1": "T0002", "r-2": "仕込完了" }],
    });
    const shigumi = cases(p.byDay["2026-11-03"])[0];
    expect(shigumi?.showKankoCheck).toBe(true);
    expect(shigumi?.gray).toBeFalsy();
    // パネル工事は報告が無いのでグレー
    expect(cases(p.byDay["2026-11-20"])[0]?.gray).toBe(true);
  });

  it("★ 工事報告を読めていないときはグレー（安全側）", () => {
    const p = payload({
      zankoRows: [["T0002", "2026-11-25"]],
      construction: [SHINCHIKU],
      reports: null,
    });
    expect(cases(p.byDay["2026-11-03"])[0]?.gray).toBe(true);
    expect(cases(p.byDay["2026-11-20"])[0]?.gray).toBe(true);
  });

  it("★ 【残工】カードも、最新の残工日でなければグレー", () => {
    const p = payload({
      zankoRows: [
        ["T0001", "2026-11-12"],
        ["T0001", "2026-11-28"],
      ],
    });
    expect(p.byDay["2026-11-12"]?.[0]?.gray).toBe(true);
    expect(p.byDay["2026-11-28"]?.[0]?.gray).toBeFalsy();
  });
});

describe("表示月・フィルターで結果が変わらない", () => {
  it("★ 最新の残工日が別の月にあっても、表示月のカードがグレーになる", () => {
    const p = payload({
      zankoRows: [["T0002", "2026-12-20"]],
      construction: [SHINCHIKU],
      year: 2026,
      month: 11,
    });
    expect(cases(p.byDay["2026-11-20"])[0]?.gray).toBe(true);
  });

  it("★ 【残工】カードのグレーは、どの月を表示しても同じ", () => {
    const rows: Array<[string, string]> = [
      ["T0001", "2026-11-12"],
      ["T0001", "2026-12-03"],
    ];
    const nov = payload({ zankoRows: rows, month: 11 });
    const dec = payload({ zankoRows: rows, month: 12 });
    expect(nov.byDay["2026-11-12"]?.[0]?.gray).toBe(true);
    expect(dec.byDay["2026-12-03"]?.[0]?.gray).toBeFalsy();
  });

  it("★ 同じ月の他のカードの有無で結果が変わらない", () => {
    const alone = payload({ zankoRows: [["T0002", "2026-11-10"]], construction: [SHINCHIKU] });
    const withOthers = payload({
      zankoRows: [["T0002", "2026-11-10"]],
      construction: [SHINCHIKU, { ...KICHIKU, [F.t]: "T0100" }],
    });
    expect(cases(withOthers.byDay["2026-11-03"]).find((i) => i.line1.includes("鈴木"))?.gray)
      .toBe(cases(alone.byDay["2026-11-03"])[0]?.gray);
  });

  it("★ 業者フィルターで絞っても、残ったカードのグレーは変わらない", () => {
    const p = payload({
      zankoRows: [["T0001", ""]],
      construction: [KICHIKU, { ...SHINCHIKU, [F.t]: "T0200" }],
    });
    const filtered = filterCalendarByDay(p.byDay, {
      selectedContractors: new Set(["株式会社アルファ"]),
      mode: "all",
    });
    expect(filtered["2026-11-05"]?.[0]?.gray).toBe(true);
    expect(filtered["2026-11-05"]?.[0]?.line1).toBe("【延期】山田 太郎様");
  });
});

describe("画面の配線", () => {
  const ROOT = process.cwd();
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

  it("★ 工事カレンダーのカードはグレーのとき専用の配色にする", () => {
    // 本文だけを塗る（下の操作の行は白のまま）
    expect(read("src/components/liff-calendar-month-page.tsx")).toContain(
      "zanko-gray-body",
    );
    const css = read("src/app/globals.css");
    expect(css).toContain(".zanko-gray-body > :first-child");
    // 施工管理のカードはダークモードで暗いグレー
    expect(css).toContain(".dark .zanko-gray-card.zanko-gray-follow-dark");
  });
});
