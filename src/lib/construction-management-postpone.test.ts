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

/**
 * 施工管理タブの【延期】とグレー（残工 段階3）。
 * 施工予定と残工だけに出す（足場の予定には付けない）。
 * 判定は工事カレンダーと同じ部品（zanko-postpone）。
 * 施工管理は工事報告を読まないので、新築・産業用は「報告なし」として扱う。
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

function construction(
  recordId: string,
  start: string,
  t: string,
  housing: string,
): AtPocketRecordRow {
  return {
    recordId,
    record: {
      [FIDS.title]: `工事${recordId}`,
      [FIDS.startDate]: start,
      [FIDS.tNumber]: t,
      [FIDS.housingStatus]: housing,
      [FIDS.contractor]: "施工業者Y",
    },
  } as unknown as AtPocketRecordRow;
}

function build(
  zankoRows: Array<[string, string]>,
  over: Partial<ConstructionManagementInput> = {},
) {
  const index = buildZankoIndex(
    zankoRows.map(([t, d], i) => ({ recordId: i + 1, record: { "z-3": t, "z-7": d } })),
    { tNumberFieldId: "z-3", dateFieldId: "z-7" },
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
    zankoEntries: buildZankoCaseEntries(index, buildContractRecordMap([]), 2026, 11),
    ...over,
  });
}

describe("施工予定の【延期】とグレー", () => {
  it("★ 186 に T番号 があれば【延期】・グレー（残工日が空でも）", () => {
    const p = build([["T0001", ""]], {
      constructionRecords: [construction("c1", "2026-11-05", "T0001", "既築案件")],
    });
    expect(p.events[0]).toMatchObject({
      kind: "construction",
      postponed: true,
      gray: true,
    });
  });

  it("★ 186 に無ければどちらも付かない", () => {
    const p = build([["T0009", ""]], {
      constructionRecords: [construction("c1", "2026-11-05", "T0001", "既築案件")],
    });
    expect(p.events[0]?.postponed).toBeFalsy();
    expect(p.events[0]?.gray).toBeFalsy();
  });

  it("★ 新築・産業用は【延期】を付けず、最新の残工日より前ならグレー", () => {
    const p = build([["T0002", "2026-11-10"]], {
      constructionRecords: [
        construction("c1", "2026-11-05", "T0002", "新築案件"),
        construction("c2", "2026-11-20", "T0002", "産業用案件"),
      ],
    });
    const byId = new Map(p.events.map((e) => [e.id, e]));
    expect(byId.get("construction:c1")?.postponed).toBeFalsy();
    expect(byId.get("construction:c1")?.gray).toBe(true);
    expect(byId.get("construction:c2")?.postponed).toBeFalsy();
    expect(byId.get("construction:c2")?.gray).toBeFalsy();
  });
});

describe("残工のグレー", () => {
  it("★ 最新の残工日でなければグレー", () => {
    const p = build([
      ["T0001", "2026-11-10"],
      ["T0001", "2026-11-25"],
    ]);
    const z = p.events.filter((e) => e.kind === "zanko");
    expect(z.map((e) => [e.dayKey, Boolean(e.gray), Boolean(e.postponed)])).toEqual([
      ["2026-11-10", true, false],
      ["2026-11-25", false, false],
    ]);
  });
});

describe("画面の配線", () => {
  const ROOT = process.cwd();
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

  it("★ カードに【延期】を付け、グレーの配色にする", () => {
    const src = read("src/components/construction-management-panel.tsx");
    expect(src).toContain("【延期】");
    expect(src).toContain("zanko-gray-card");
  });
});
