import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { ConstructionFieldIds } from "@/lib/calendar-kojo";
import { buildCalendarPayload } from "@/lib/calendar-kojo";
import { buildContractRecordMap } from "@/lib/contract-records";
import {
  buildConstructionManagementPayload,
  CONSTRUCTION_MANAGEMENT_OTHER_BRANCH as OTHER,
} from "@/lib/construction-management";
import type { ConstructionManagementInput } from "@/lib/construction-management";
import {
  ALL_KINDS,
  countConstructionEvents,
  filterConstructionEvents,
  KIND_META,
  KIND_ORDER,
  ALL_BRANCHES,
} from "@/lib/construction-management-view";
import type { CustomerCrmCandidate } from "@/lib/customer-crm-list";
import { buildZankoCaseEntries } from "@/lib/zanko-cards";
import { buildZankoIndex } from "@/lib/zanko-index";

/**
 * 施工管理タブの【残工】（残工 段階2）。
 *
 *   - 4つ目の区分「残工」として出る（色は既存の3つと別）
 *   - 区分フィルター・件数に入る
 *   - カードは他の区分と同じ形（お客様名・支店・施工店）
 *   - 中身は契約情報入力（お客様情報）から
 *   - 工事カレンダーと同じ残工が出る（同じ部品から作る）
 */

const AP = "field-ap";
const CL = "field-cl";

const FIDS: ConstructionFieldIds = {
  title: "c-title",
  contractor: "c-contractor",
  startDate: "c-start",
  endDate: "",
  memo: "",
  housingStatus: "",
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

const ROSTER: Record<string, string | null> = {
  "担当 A": "支店A",
  "担当 B": "支店B",
};

function customer(
  recordId: string,
  over: Partial<CustomerCrmCandidate> & { ap?: string; cl?: string } = {},
): CustomerCrmCandidate {
  const { ap, cl, ...rest } = over;
  return {
    recordId,
    customerName: `顧客${recordId}`,
    subtitle: "",
    tNumber: `T-${recordId}`,
    isDocumentMissing: false,
    isSubsidyTarget: false,
    combinedSubsidyName: null,
    isConstructionDateUnset: false,
    isCancelled: false,
    isCompleted: false,
    housingStatus: "既築案件",
    contractorName: "施工業者Z",
    sortKey: 0,
    audience: { [AP]: ap ?? "担当 A", [CL]: cl ?? "" },
    scaffold: {
      contractor: "足場業者X",
      request: "依頼内容X",
      installDate: "",
      removalDate: "",
    },
    ...rest,
  };
}

function entriesFor(
  zankoRows: Array<[string, string]>,
  customers: CustomerCrmCandidate[],
) {
  const index = buildZankoIndex(
    zankoRows.map(([t, d], i) => ({
      recordId: i + 1,
      record: { "z-3": t, "z-7": d },
    })),
    { tNumberFieldId: "z-3", dateFieldId: "z-7" },
  );
  return buildZankoCaseEntries(index, buildContractRecordMap(customers), 2026, 11);
}

function build(over: Partial<ConstructionManagementInput> = {}) {
  return buildConstructionManagementPayload({
    year: 2026,
    month: 11,
    customers: [],
    apFieldId: AP,
    clFieldId: CL,
    constructionRecords: [],
    constructionFieldIds: FIDS,
    workplaceOfStaff: (name) => ROSTER[name] ?? null,
    rosterWorkplaces: ["支店A", "支店B"],
    selfWorkplace: "支店A",
    correlationId: "cid-1",
    ...over,
  });
}

describe("残工の区分", () => {
  it("★ 186 の残工日に「残工」の予定が出る", () => {
    const customers = [customer("1", { tNumber: "T0001", customerName: "山田 太郎" })];
    const p = build({
      customers,
      zankoEntries: entriesFor([["T0001", "2026-11-05"]], customers),
    });

    const z = p.events.filter((e) => e.kind === "zanko");
    expect(z).toHaveLength(1);
    expect(z[0]).toMatchObject({
      dayKey: "2026-11-05",
      customerName: "山田 太郎",
      tNumber: "T0001",
      branches: ["支店A"],
      // 施工店は契約情報入力（お客様情報）の施工業者
      constructionContractor: "施工業者Z",
      customerMatched: true,
    });
    expect(p.counts.zanko).toBe(1);
  });

  it("★ 支店は AP・CL の支店の和集合（他の区分と同じ）", () => {
    const customers = [
      customer("1", { tNumber: "T0001", ap: "担当 A", cl: "担当 B" }),
    ];
    const p = build({
      customers,
      zankoEntries: entriesFor([["T0001", "2026-11-05"]], customers),
    });

    expect(p.events[0]?.branches.sort()).toEqual(["支店A", "支店B"]);
    expect(p.events[0]?.apStaffNames).toEqual(["担当 A"]);
  });

  it("★ 契約情報入力に該当が無ければ、お客様名・施工店は空・支店は「その他」", () => {
    const p = build({ zankoEntries: entriesFor([["T0009", "2026-11-05"]], []) });

    expect(p.events[0]).toMatchObject({
      kind: "zanko",
      customerName: "",
      constructionContractor: "",
      branches: [OTHER],
      customerMatched: false,
    });
  });

  it("★ 施工予定日が過去の月でも、残工日が表示月なら出る", () => {
    const customers = [
      customer("1", { tNumber: "T0001", constructionDate: "2026-09-10" }),
    ];
    const p = build({
      customers,
      zankoEntries: entriesFor([["T0001", "2026-11-05"]], customers),
    });

    expect(p.events.map((e) => `${e.kind}:${e.dayKey}`)).toEqual([
      "zanko:2026-11-05",
    ]);
    expect(p.events[0]?.dates.construction).toBe("2026-09-10");
  });

  it("★ 材料が無ければ（186 が読めない）残工は出ず、件数は0", () => {
    const p = build({ customers: [customer("1")] });

    expect(p.events.filter((e) => e.kind === "zanko")).toEqual([]);
    expect(p.counts.zanko).toBe(0);
  });
});

describe("表示（区分・色・フィルター）", () => {
  it("★ 4つ目の区分として並ぶ", () => {
    expect(KIND_ORDER).toEqual([
      "scaffoldInstall",
      "construction",
      "scaffoldRemoval",
      "zanko",
    ]);
    expect(KIND_META.zanko.label).toBe("残工");
    expect(ALL_KINDS.has("zanko")).toBe(true);
  });

  it("★ 色は既存の3つ（青・緑・橙）と別", () => {
    const others = [
      KIND_META.scaffoldInstall.color,
      KIND_META.construction.color,
      KIND_META.scaffoldRemoval.color,
    ].map((c) => c.toUpperCase());
    expect(others).not.toContain(KIND_META.zanko.color.toUpperCase());
  });

  it("★ 区分フィルターで残工だけに絞れる・外せる", () => {
    const customers = [
      customer("1", { tNumber: "T0001", scaffold: {
        contractor: "足場業者X",
        request: "",
        installDate: "2026-11-03",
        removalDate: "",
      } }),
    ];
    const p = build({
      customers,
      zankoEntries: entriesFor([["T0001", "2026-11-05"]], customers),
    });

    const onlyZanko = filterConstructionEvents(
      p.events,
      ALL_BRANCHES,
      new Set(["zanko"] as const),
    );
    expect(onlyZanko.map((e) => e.kind)).toEqual(["zanko"]);

    const withoutZanko = filterConstructionEvents(
      p.events,
      ALL_BRANCHES,
      new Set(["scaffoldInstall", "construction", "scaffoldRemoval"] as const),
    );
    expect(withoutZanko.map((e) => e.kind)).toEqual(["scaffoldInstall"]);

    expect(countConstructionEvents(p.events, ALL_KINDS).zanko).toBe(1);
  });
});

describe("両タブで同じ残工が出る", () => {
  it("★ 同じ材料から、工事カレンダーと施工管理に同じ日・同じ T番号 で出る", () => {
    const customers = [
      customer("1", { tNumber: "T0001", customerName: "山田 太郎" }),
      customer("2", { tNumber: "T0002", customerName: "鈴木 一郎" }),
    ];
    const entries = entriesFor(
      [
        ["T0001", "2026-11-05"],
        ["T0002", "2026-11-05"],
        ["T0002", "2026-11-20"],
        ["T0003", "2026-11-21"],
      ],
      customers,
    );

    const calendar = buildCalendarPayload(2026, 11, [], null, [], null, {
      zankoEntries: entries,
    });
    const fromCalendar = Object.entries(calendar.byDay)
      .flatMap(([day, items]) =>
        items.filter((i) => i.zanko).map((i) => `${day}:${i.tNumber}`),
      )
      .sort();

    const management = build({ customers, zankoEntries: entries });
    const fromManagement = management.events
      .filter((e) => e.kind === "zanko")
      .map((e) => `${e.dayKey}:${e.tNumber}`)
      .sort();

    expect(fromCalendar).toEqual([
      "2026-11-05:T0001",
      "2026-11-05:T0002",
      "2026-11-20:T0002",
      "2026-11-21:T0003",
    ]);
    expect(fromManagement).toEqual(fromCalendar);
  });
});

describe("配線", () => {
  const ROOT = process.cwd();
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

  it("★ 両タブとも同じ部品で材料を読み、同じ部品で表示月の残工を決める", () => {
    for (const rel of [
      "src/app/api/calendar/route.ts",
      "src/app/api/calendar/construction-management/route.ts",
    ]) {
      const src = read(rel);
      expect(src, rel).toContain("readZankoCalendarSources(");
      expect(src, rel).toContain("buildZankoCaseEntries(");
    }
  });

  it("★ 施工管理のカードで、残工の3行目は「施工店」", () => {
    const src = read("src/components/construction-management-panel.tsx");
    expect(src).toContain('event.kind === "scaffoldInstall" || event.kind === "scaffoldRemoval"');
  });

  it("★ 施工管理の詳細に残工日を出す", () => {
    expect(read("src/components/construction-management-panel.tsx")).toContain(
      '"残工日"',
    );
  });

  it("★ 工事カレンダーの残工カードは、お客様情報の導線と工事対応者の変更を出す", () => {
    const src = read("src/components/liff-calendar-month-page.tsx");
    // 工事対応者の変更は普通のカードと同じ条件で出す（仕様変更）
    expect(src).not.toContain("{item.zanko ? null : handlerFromStaff ? (");
    expect(src).toContain("{handlerFromStaff ? (");
    // 工事日の変更・地図は残工カードでは出さない
    expect(src).toContain("!item.zanko &&");
    expect(src).toContain("{!item.zanko ? (");
    // お客様情報の導線は条件を変えない
    expect(src).toContain("<CaseCustomerInfoLink");
  });
});
