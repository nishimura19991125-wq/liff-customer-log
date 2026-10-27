import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { AtPocketRecordRow } from "@/lib/atpocket";
import type { ConstructionFieldIds } from "@/lib/calendar-kojo";
import { buildContractRecordMap } from "@/lib/contract-records";
import { buildConstructionManagementPayload } from "@/lib/construction-management";
import type { ConstructionManagementInput } from "@/lib/construction-management";
import { buildZankoCaseEntries } from "@/lib/zanko-cards";
import { buildZankoIndex } from "@/lib/zanko-index";
import { buildZankoReportFacts } from "@/lib/zanko-report";

/**
 * 施工管理タブの ⚠️・赤枠と【残工→延期】（残工 段階4-b）。
 * 判定は工事カレンダーと同じ部品。施工管理も工事報告を読むようになった。
 */

const FIDS: ConstructionFieldIds = {
  title: "c-title",
  contractor: "c-contractor",
  startDate: "c-start",
  endDate: "",
  memo: "",
  housingStatus: "c-housing",
  shigumi: "",
  panelWork: "",
  electricWork: "",
  appSettingsDay: "",
  tNumber: "c-t",
  manufacturer: "",
  panelCapacity: "",
  batteryCapacity: "",
  constructionHandler: "",
};

const REPORT_FIELDS = [
  { uniqueId: "r-1", caption: "T番号" },
  { uniqueId: "r-2", caption: "報告内容" },
  { uniqueId: "r-3", caption: "完工日" },
];

function construction(recordId: string, start: string, t: string, housing: string) {
  return {
    recordId,
    record: {
      [FIDS.title]: `工事${recordId}`,
      [FIDS.startDate]: start,
      [FIDS.tNumber]: t,
      [FIDS.housingStatus]: housing,
    },
  } as unknown as AtPocketRecordRow;
}

function build(
  zankoRows: Array<[string, string]>,
  reports: Array<[string, string, string]> | null,
  over: Partial<ConstructionManagementInput> = {},
) {
  const index = buildZankoIndex(
    zankoRows.map(([t, d], i) => ({ recordId: i + 1, record: { "z-3": t, "z-7": d } })),
    { tNumberFieldId: "z-3", dateFieldId: "z-7" },
  );
  const facts =
    reports === null
      ? null
      : buildZankoReportFacts(
          reports.map(([t, c, k], i) => ({
            recordId: 900 + i,
            record: { "r-1": t, "r-2": c, "r-3": k },
          })),
          REPORT_FIELDS,
        );
  return buildConstructionManagementPayload({
    year: 2026,
    month: 11,
    customers: [],
    apFieldId: null,
    clFieldId: null,
    constructionRecords: [],
    constructionFieldIds: FIDS,
    workplaceOfStaff: () => null,
    rosterWorkplaces: [],
    selfWorkplace: null,
    correlationId: "cid",
    zankoIndex: index,
    zankoReportFacts: facts,
    zankoEntries: buildZankoCaseEntries(index, buildContractRecordMap([]), 2026, 11, facts),
    ...over,
  });
}

describe("施工予定の ⚠️ と赤枠", () => {
  it("★ 残工日が空のレコードがあれば出る", () => {
    const p = build([["T0001", ""]], [], {
      constructionRecords: [construction("c1", "2026-11-05", "T0001", "既築案件")],
    });
    expect(p.events[0]?.zankoNoDateWarn).toBe(true);
  });

  it("★ 完工の報告があれば出ない（✅ と同じ判定）", () => {
    const p = build([["T0001", ""]], [["T0001", "完工", ""]], {
      constructionRecords: [construction("c1", "2026-11-05", "T0001", "既築案件")],
    });
    expect(p.events[0]?.zankoNoDateWarn).toBeFalsy();
  });

  it("★ 工事報告を読めていなければ出る（安全側）", () => {
    const p = build([["T0001", ""]], null, {
      constructionRecords: [construction("c1", "2026-11-05", "T0001", "既築案件")],
    });
    expect(p.events[0]?.zankoNoDateWarn).toBe(true);
  });

  it("★ 新築・産業用のグレーは工事報告の完工でスキップされる（工事カレンダーとそろう）", () => {
    const rows = [construction("c1", "2026-11-05", "T0002", "新築案件")];
    const noReport = build([["T0002", "2026-11-20"]], null, { constructionRecords: rows });
    const reported = build([["T0002", "2026-11-20"]], [["T0002", "完工", ""]], {
      constructionRecords: rows,
    });
    expect(noReport.events[0]?.gray).toBe(true);
    expect(reported.events[0]?.gray).toBeFalsy();
  });
});

describe("残工の【残工→延期】と解除", () => {
  it("★ 残工日が空のレコードがあれば【残工→延期】・グレー・⚠️", () => {
    const p = build(
      [
        ["T0001", "2026-11-10"],
        ["T0001", ""],
      ],
      [],
    );
    const z = p.events.find((e) => e.kind === "zanko");
    expect(z).toMatchObject({ zankoEmptyPostponed: true, gray: true, zankoNoDateWarn: true });
  });

  it("★ 解除した案件は【残工→延期】にならず、⚠️ も出ない・グレー", () => {
    const p = build(
      [
        ["T0001", "2026-11-10"],
        ["T0001", ""],
      ],
      [["T0001", "完工", "2026-11-11"]],
    );
    const z = p.events.find((e) => e.kind === "zanko");
    expect(z?.zankoEmptyPostponed).toBeFalsy();
    expect(z?.zankoNoDateWarn).toBeFalsy();
    expect(z?.gray).toBe(true);
  });
});

describe("画面の配線", () => {
  const ROOT = process.cwd();
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
  const PANEL = read("src/components/construction-management-panel.tsx");

  it("★ 区分バッジを「残工→延期」に変える（区分は残工のまま）", () => {
    expect(PANEL).toContain('"残工→延期"');
    expect(PANEL).toContain('e.zankoEmptyPostponed ? "残工→延期"');
    expect(PANEL).toContain("label={kindBadgeLabel(event)}");
  });

  it("★ ⚠️ はお客様名の行の末尾・区分バッジの手前。カード全体に赤枠", () => {
    const icon = PANEL.indexOf("zanko-warn-icon");
    const badge = PANEL.indexOf("<KindBadge", icon);
    expect(icon).toBeGreaterThan(0);
    expect(badge).toBeGreaterThan(icon);
    expect(PANEL).toContain("zanko-warn-card");
    expect(PANEL).toContain("title={ZANKO_NO_DATE_WARN_TITLE}");
  });

  it("★ 施工管理の API が工事報告を読む（工事カレンダーと同じキャッシュ）", () => {
    const src = read("src/app/api/calendar/construction-management/route.ts");
    expect(src).toContain("fetchCalendarReportRecordsCached(");
    expect(src).toContain("collectReportFieldsCsv(");
    expect(src).toContain("buildZankoReportFacts(");
  });
});
