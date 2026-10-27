import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CalendarMonthApiItem } from "@/lib/calendar-api-types";
import {
  buildCalendarPayload,
  collectReportFieldsCsv,
  resolveReportFieldIds,
} from "@/lib/calendar-kojo";
import { buildContractRecordMap } from "@/lib/contract-records";
import { buildZankoCaseEntries } from "@/lib/zanko-cards";
import { buildZankoIndex } from "@/lib/zanko-index";
import {
  decideZankoCardMarks,
  isZankoResolvedByKanko,
} from "@/lib/zanko-postpone";
import { buildZankoReportFacts } from "@/lib/zanko-report";

/**
 * 完工報告による延期扱いの解除ほか（残工 段階4-b）。
 *
 *   ZANKO_RESOLVE_BY_LATER_KANKO     true  最後の残工日以降の完工日で解除
 *   ZANKO_RESOLVE_SAME_DAY_AS_LATER  true  同じ日も「後」とみなす
 *   ZANKO_RESOLVE_APPLIES_TO_KOUJI   false 工事登録側の ⚠️ は解除しない
 *   ZANKO_EMPTY_TREATS_AS_POSTPONED  true  残工日が空のレコードがあれば延期扱い
 *   ZANKO_EMPTY_POSTPONED_PREFIX     【残工→延期】
 *   ZANKO_KANKO_MARK_LATEST_ONLY     true  解除した案件の ✅ は最後の残工日だけ
 */

const ZFIDS = { tNumberFieldId: "z-3", dateFieldId: "z-7" };

function zanko(rows: Array<[string, string]>) {
  return buildZankoIndex(
    rows.map(([t, d], i) => ({ recordId: i + 1, record: { "z-3": t, "z-7": d } })),
    ZFIDS,
  );
}

const REPORT_FIELDS = [
  { uniqueId: "r-1", caption: "T番号" },
  { uniqueId: "r-2", caption: "報告内容" },
  { uniqueId: "r-3", caption: "完工日" },
];

function reportRows(rows: Array<[string, string, string]>) {
  return rows.map(([t, content, kanko], i) => ({
    recordId: 900 + i,
    record: { "r-1": t, "r-2": content, "r-3": kanko },
  }));
}

function facts(rows: Array<[string, string, string]>, fields = REPORT_FIELDS) {
  return buildZankoReportFacts(reportRows(rows), fields);
}

let savedEnv: string | undefined;
beforeEach(() => {
  savedEnv = process.env.CALENDAR_REPORT_KANKO_DATE_FIELD_ID;
  delete process.env.CALENDAR_REPORT_KANKO_DATE_FIELD_ID;
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env.CALENDAR_REPORT_KANKO_DATE_FIELD_ID;
  else process.env.CALENDAR_REPORT_KANKO_DATE_FIELD_ID = savedEnv;
});

describe("完工日の列", () => {
  it("★ 見出し「完工日」の完全一致で決め、取得する列に入れる", () => {
    const rf = resolveReportFieldIds(REPORT_FIELDS);
    expect(rf.kankoDate).toBe("r-3");
    expect(collectReportFieldsCsv(rf).split(",")).toContain("r-3");
  });

  it("★ 部分一致では拾わない（完工日予定など）", () => {
    const rf = resolveReportFieldIds([
      ...REPORT_FIELDS.slice(0, 2),
      { uniqueId: "r-9", caption: "完工日予定" },
    ]);
    expect(rf.kankoDate).toBe("");
  });

  it("★ 環境変数 CALENDAR_REPORT_KANKO_DATE_FIELD_ID が優先", () => {
    process.env.CALENDAR_REPORT_KANKO_DATE_FIELD_ID = "r-9";
    const rf = resolveReportFieldIds([
      ...REPORT_FIELDS,
      { uniqueId: "r-9", caption: "完了日" },
    ]);
    expect(rf.kankoDate).toBe("r-9");
  });
});

describe("延期扱いの解除", () => {
  const IDX = zanko([
    ["T0001", "2026-11-10"],
    ["T0001", "2026-11-20"],
  ]);

  it("★ 最後の残工日より後に完工報告があれば解除", () => {
    expect(isZankoResolvedByKanko(IDX, facts([["T0001", "完工", "2026-11-25"]]), "T0001")).toBe(true);
  });

  it("★ 同じ日でも解除（ZANKO_RESOLVE_SAME_DAY_AS_LATER）", () => {
    expect(isZankoResolvedByKanko(IDX, facts([["T0001", "完工", "2026-11-20"]]), "T0001")).toBe(true);
  });

  it("★ 最後の残工日より前の完工日では解除しない", () => {
    expect(isZankoResolvedByKanko(IDX, facts([["T0001", "完工", "2026-11-15"]]), "T0001")).toBe(false);
  });

  it("★ 完工日が空なら解除しない", () => {
    expect(isZankoResolvedByKanko(IDX, facts([["T0001", "完工", ""]]), "T0001")).toBe(false);
  });

  it("★ 完工日の列が無ければ解除しない", () => {
    const f = facts([["T0001", "完工", "2026-11-25"]], REPORT_FIELDS.slice(0, 2));
    expect(isZankoResolvedByKanko(IDX, f, "T0001")).toBe(false);
  });

  it("★ 報告内容が完工でない行の日付は使わない", () => {
    expect(
      isZankoResolvedByKanko(IDX, facts([["T0001", "残工", "2026-11-25"]]), "T0001"),
    ).toBe(false);
  });

  it("★ 工事報告を読めていなければ解除しない", () => {
    expect(isZankoResolvedByKanko(IDX, null, "T0001")).toBe(false);
  });

  it("★ 残工日が1件も入っていない案件は解除しない", () => {
    const idx = zanko([["T0001", ""]]);
    expect(isZankoResolvedByKanko(idx, facts([["T0001", "完工", "2026-11-25"]]), "T0001")).toBe(false);
  });

  it("★ T番号 は NFKC でそろえる", () => {
    expect(
      isZankoResolvedByKanko(IDX, facts([["Ｔ０００１", "完工", "2026/11/25"]]), "T0001"),
    ).toBe(true);
  });
});

describe("【残工】カードの表示（decideZankoCardMarks）", () => {
  it("★ 解除したカードは【残工】のままグレー・⚠️ なし・✅ は最後の残工日だけ", () => {
    const idx = zanko([
      ["T0001", "2026-11-10"],
      ["T0001", "2026-11-20"],
    ]);
    const f = facts([["T0001", "完工", "2026-11-21"]]);
    const early = decideZankoCardMarks(idx, f, "T0001", "2026-11-10");
    const last = decideZankoCardMarks(idx, f, "T0001", "2026-11-20");

    expect(early).toMatchObject({ prefix: "【残工】", gray: true, warn: false, kankoCheck: false });
    expect(last).toMatchObject({ prefix: "【残工】", gray: true, warn: false, kankoCheck: true });
  });

  it("★ 残工日が空のレコードがあれば【残工→延期】・グレー・⚠️", () => {
    const idx = zanko([
      ["T0001", "2026-11-10"],
      ["T0001", ""],
    ]);
    expect(decideZankoCardMarks(idx, facts([]), "T0001", "2026-11-10")).toMatchObject({
      prefix: "【残工→延期】",
      gray: true,
      warn: true,
    });
  });

  it("★ 【残工→延期】の ⚠️ は完了報告でスキップしない（本体工事の完工は残工の完了ではない）", () => {
    const idx = zanko([
      ["T0001", "2026-11-10"],
      ["T0001", ""],
    ]);
    // 完工の報告はあるが、完工日が最後の残工日より前なので解除されない
    const m = decideZankoCardMarks(idx, facts([["T0001", "完工", "2026-11-01"]]), "T0001", "2026-11-10");
    expect(m.prefix).toBe("【残工→延期】");
    expect(m.warn).toBe(true);
    // ✅ は本体工事の完工を見ているだけ（案B）
    expect(m.kankoCheck).toBe(true);
  });

  it("★ 解除した案件には【残工→延期】を付けない", () => {
    const idx = zanko([
      ["T0001", "2026-11-10"],
      ["T0001", ""],
    ]);
    const m = decideZankoCardMarks(idx, facts([["T0001", "完工", "2026-11-12"]]), "T0001", "2026-11-10");
    expect(m).toMatchObject({ prefix: "【残工】", gray: true, warn: false, kankoCheck: true });
  });

  it("★ 解除していない案件は、完工の報告があれば全部のカードに ✅（案B）・グレーは段階3のまま", () => {
    const idx = zanko([
      ["T0001", "2026-11-10"],
      ["T0001", "2026-11-20"],
    ]);
    // 完工日が空なので解除はされない
    const f = facts([["T0001", "完工", ""]]);
    expect(decideZankoCardMarks(idx, f, "T0001", "2026-11-10")).toMatchObject({
      prefix: "【残工】",
      gray: true,
      warn: false,
      kankoCheck: true,
    });
    expect(decideZankoCardMarks(idx, f, "T0001", "2026-11-20")).toMatchObject({
      gray: false,
      kankoCheck: true,
    });
  });

  it("★ 工事報告を読めていなければ ✅ は出ない", () => {
    const idx = zanko([["T0001", "2026-11-10"]]);
    expect(decideZankoCardMarks(idx, null, "T0001", "2026-11-10").kankoCheck).toBe(false);
  });
});

// ── 工事カレンダーの月データ ──

const F = { name: "field-1", start: "field-2", housing: "field-3", t: "field-4" };
const CONSTRUCTION_FIELDS = [
  { uniqueId: F.name, caption: "お客様名" },
  { uniqueId: F.start, caption: "施工予定日" },
  { uniqueId: F.housing, caption: "住宅ステータス" },
  { uniqueId: F.t, caption: "T番号" },
];

function payload(opts: {
  zankoRows: Array<[string, string]>;
  reports: Array<[string, string, string]> | null;
  construction?: Array<Record<string, unknown>>;
}) {
  const idx = zanko(opts.zankoRows);
  const rows = opts.reports === null ? null : reportRows(opts.reports);
  const fields = opts.reports === null ? null : REPORT_FIELDS;
  return buildCalendarPayload(
    2026,
    11,
    (opts.construction ?? []).map((record, i) => ({ recordId: 100 + i, record })),
    rows,
    CONSTRUCTION_FIELDS,
    fields,
    {
      zankoIndex: idx,
      zankoEntries: buildZankoCaseEntries(
        idx,
        buildContractRecordMap([
          { recordId: "5", tNumber: "T0001", customerName: "山田 太郎" },
        ]),
        2026,
        11,
        buildZankoReportFacts(rows, fields),
      ),
    },
  );
}

function zankoCard(day: CalendarMonthApiItem[] | undefined) {
  return (day ?? []).find((i) => i.zanko);
}

const KICHIKU = {
  [F.name]: "山田 太郎",
  [F.start]: "2026-11-03",
  [F.housing]: "既築案件",
  [F.t]: "T0001",
};

describe("工事カレンダー", () => {
  it("★ 【残工→延期】お客様名様・グレー・⚠️ と赤枠", () => {
    const p = payload({
      zankoRows: [
        ["T0001", "2026-11-10"],
        ["T0001", ""],
      ],
      reports: [],
    });
    const z = zankoCard(p.byDay["2026-11-10"]);
    expect(z?.line1).toBe("【残工→延期】山田 太郎様");
    expect(z?.gray).toBe(true);
    expect(z?.zankoNoDateWarn).toBe(true);
  });

  it("★ 解除したカードは【残工】のままグレー・⚠️ なし・✅ は最後の残工日だけ", () => {
    const p = payload({
      zankoRows: [
        ["T0001", "2026-11-10"],
        ["T0001", "2026-11-20"],
      ],
      reports: [["T0001", "完工", "2026-11-20"]],
    });
    const early = zankoCard(p.byDay["2026-11-10"]);
    const last = zankoCard(p.byDay["2026-11-20"]);
    expect(early?.line1).toBe("【残工】山田 太郎様");
    expect(early?.gray).toBe(true);
    expect(early?.zankoNoDateWarn).toBeFalsy();
    expect(early?.showKankoCheck).toBe(false);
    expect(last?.gray).toBe(true);
    expect(last?.showKankoCheck).toBe(true);
  });

  it("★ 工事登録側の ⚠️ は解除しない（ZANKO_RESOLVE_APPLIES_TO_KOUJI = false）", () => {
    const p = payload({
      zankoRows: [
        ["T0001", "2026-11-10"],
        ["T0001", ""],
      ],
      // T0001 は解除される。工事登録側のカードは T番号 を全角にして、
      // ✅ の判定（NFKC しない）で報告なしにする
      reports: [["T0001", "完工", "2026-11-12"]],
      construction: [{ ...KICHIKU, [F.t]: "Ｔ０００１" }],
    });
    // 【残工】カードは解除される
    expect(zankoCard(p.byDay["2026-11-10"])?.zankoNoDateWarn).toBeFalsy();
    // 工事登録側のカードは ✅ の判定（全角の T番号 は工事報告と突き合わない）で
    // 報告なし → ⚠️ は残る
    const kouji = (p.byDay["2026-11-03"] ?? []).find((i) => !i.zanko);
    expect(kouji?.showKankoCheck).toBe(false);
    expect(kouji?.zankoNoDateWarn).toBe(true);
  });

  it("★ 解除していない案件の工事登録側の ✅ は変わらない", () => {
    const p = payload({
      zankoRows: [["T0001", "2026-11-10"]],
      reports: [["T0001", "完工", ""]],
      construction: [KICHIKU],
    });
    const kouji = (p.byDay["2026-11-03"] ?? []).find((i) => !i.zanko);
    expect(kouji?.showKankoCheck).toBe(true);
  });

  it("★ 残工日が1件も入っていない案件は【残工】カードが出ず、工事登録側に ⚠️", () => {
    const p = payload({
      zankoRows: [["T0001", ""]],
      reports: [],
      construction: [KICHIKU],
    });
    expect(Object.values(p.byDay).flat().filter((i) => i.zanko)).toEqual([]);
    const kouji = (p.byDay["2026-11-03"] ?? []).find((i) => !i.zanko);
    expect(kouji?.zankoNoDateWarn).toBe(true);
  });
});
