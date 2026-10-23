import { describe, expect, it } from "vitest";

import type { AtPocketRecordRow } from "@/lib/atpocket";
import type { ConstructionFieldIds } from "@/lib/calendar-kojo";
import {
  buildConstructionManagementPayload,
  CONSTRUCTION_MANAGEMENT_OTHER_BRANCH as OTHER,
  filterConstructionManagementEventsByBranch,
  jstDayKeyFromPocketDate,
} from "@/lib/construction-management";
import type { ConstructionManagementInput } from "@/lib/construction-management";
import type { CustomerCrmCandidate } from "@/lib/customer-crm-list";

/**
 * 施工管理タブの応答の組み立て（@pocket は呼ばない）。
 * 氏名・T番号 はすべて架空の値。
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
  inputStatus: "",
  zankoDay: "",
  constructionHandler: "",
};

/** 名簿: 氏名（正規化済み）→ 勤務場所 */
const ROSTER: Record<string, string | null> = {
  "担当 A": "支店A",
  "担当 B": "支店B",
  "担当 空": null,
};

function customer(
  recordId: string,
  over: Partial<CustomerCrmCandidate> & {
    ap?: string;
    cl?: string;
    install?: string;
    removal?: string;
  } = {},
): CustomerCrmCandidate {
  const { ap, cl, install, removal, ...rest } = over;
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
    housingStatus: "",
    contractorName: "",
    sortKey: 0,
    audience: { [AP]: ap ?? "担当 A", [CL]: cl ?? "" },
    scaffold: {
      contractor: "足場業者X",
      request: "依頼内容X",
      installDate: install ?? "",
      removalDate: removal ?? "",
    },
    ...rest,
  };
}

function construction(
  recordId: string,
  start: unknown,
  t: string,
  title = `工事${recordId}`,
): AtPocketRecordRow {
  return {
    recordId,
    record: {
      [FIDS.title]: title,
      [FIDS.startDate]: start,
      [FIDS.tNumber]: t,
      [FIDS.contractor]: "施工業者Y",
    },
  } as unknown as AtPocketRecordRow;
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
    rosterWorkplaces: ["支店B", "支店A"],
    selfWorkplace: "支店A",
    correlationId: "cid-1",
    ...over,
  });
}

function kinds(p: ReturnType<typeof build>) {
  return p.events.map((e) => `${e.kind}:${e.dayKey}`);
}

describe("3種類の予定", () => {
  it("★ 足場設置日・足場解体日・施工予定日がそれぞれ返る", () => {
    const p = build({
      customers: [customer("1", { install: "2026-11-05", removal: "2026-11-25" })],
      constructionRecords: [construction("c1", "2026/11/10", "T-1")],
    });

    expect(kinds(p)).toEqual([
      "scaffoldInstall:2026-11-05",
      "construction:2026-11-10",
      "scaffoldRemoval:2026-11-25",
    ]);
    const install = p.events[0]!;
    expect(install.scaffoldContractor).toBe("足場業者X");
    expect(install.scaffoldRequest).toBe("依頼内容X");
    const c = p.events[1]!;
    expect(c.customerName).toBe("工事c1");
    expect(c.constructionContractor).toBe("施工業者Y");
    expect(c.customerMatched).toBe(true);
  });

  it("★ 日付が未登録の案件は含めない", () => {
    const p = build({
      customers: [customer("1", { install: "", removal: "" })],
      constructionRecords: [construction("c1", "", "T-1")],
    });

    expect(p.events).toEqual([]);
    expect(p.counts).toEqual({
      scaffoldInstall: 0,
      scaffoldRemoval: 0,
      construction: 0,
    });
  });

  it("読めない日付は含めない", () => {
    const p = build({
      customers: [customer("1", { install: "未定", removal: "2026-11-31" })],
    });
    expect(p.events).toEqual([]);
  });

  it("★ 足場の列が未設定（値が空）でもエラーにせず、施工予定だけ返す", () => {
    const p = build({
      customers: [
        customer("1", {
          scaffold: {
            contractor: "",
            request: "",
            installDate: "",
            removalDate: "",
          },
        }),
        // scaffold を持たない古い形のデータ
        customer("2", { scaffold: undefined }),
      ],
      constructionRecords: [construction("c1", "2026-11-10", "T-1")],
    });

    expect(kinds(p)).toEqual(["construction:2026-11-10"]);
    expect(p.events[0]?.scaffoldContractor).toBe("");
  });
});

describe("月の範囲", () => {
  it("★ 月初・月末は含み、前月末・翌月初は含めない", () => {
    const p = build({
      customers: [
        customer("1", { install: "2026-10-31", removal: "2026-11-01" }),
        customer("2", { install: "2026-11-30", removal: "2026-12-01" }),
      ],
      constructionRecords: [
        construction("c1", "2026-10-31", "T-1"),
        construction("c2", "2026-11-01", "T-1"),
        construction("c3", "2026-11-30", "T-2"),
        construction("c4", "2026-12-01", "T-2"),
      ],
    });

    expect(kinds(p)).toEqual([
      "construction:2026-11-01",
      "scaffoldRemoval:2026-11-01",
      "scaffoldInstall:2026-11-30",
      "construction:2026-11-30",
    ]);
  });

  it("★ 本体の query が返す前月開始の工事は、施工予定日で絞り直す", () => {
    const p = build({
      constructionRecords: [construction("c1", "2026-10-28", "T-1")],
    });
    expect(p.events).toEqual([]);
  });
});

describe("JST での判定", () => {
  it("★ Z 付きの日時は JST の日付で判定する（UTC 10/31 15:00 は JST 11/1）", () => {
    expect(jstDayKeyFromPocketDate("2026-10-31T15:00:00Z")).toBe("2026-11-01");
    expect(jstDayKeyFromPocketDate("2026-11-30T15:00:00Z")).toBe("2026-12-01");

    const p = build({
      constructionRecords: [
        construction("c1", "2026-10-31T15:00:00Z", "T-1"),
        construction("c2", "2026-11-30T15:00:00Z", "T-1"),
      ],
    });
    expect(kinds(p)).toEqual(["construction:2026-11-01"]);
  });

  it("日付だけの値・{ value } の形も読める", () => {
    expect(jstDayKeyFromPocketDate("2026/11/3")).toBe("2026-11-03");
    expect(jstDayKeyFromPocketDate("2026-11-03")).toBe("2026-11-03");
    expect(jstDayKeyFromPocketDate({ value: "2026/11/03" })).toBe("2026-11-03");
    expect(jstDayKeyFromPocketDate("")).toBeNull();
    expect(jstDayKeyFromPocketDate(null)).toBeNull();
  });
});

describe("支店", () => {
  it("★ AP と CL の支店が違う案件は、両方の支店で返る", () => {
    const p = build({
      customers: [
        customer("1", { ap: "担当 A", cl: "担当 B", install: "2026-11-05" }),
      ],
    });

    expect(p.events[0]?.branches.sort()).toEqual(["支店A", "支店B"]);
    expect(filterConstructionManagementEventsByBranch(p.events, "支店A")).toHaveLength(1);
    expect(filterConstructionManagementEventsByBranch(p.events, "支店B")).toHaveLength(1);
  });

  it("★ 支店ごとの件数を足すと全体より多くなる（1件が2支店に出る）", () => {
    const p = build({
      customers: [
        customer("1", { ap: "担当 A", cl: "担当 B", install: "2026-11-05" }),
        customer("2", { ap: "担当 A", install: "2026-11-06" }),
      ],
    });
    const perBranch =
      filterConstructionManagementEventsByBranch(p.events, "支店A").length +
      filterConstructionManagementEventsByBranch(p.events, "支店B").length;
    expect(p.events).toHaveLength(2);
    expect(perBranch).toBe(3);
  });

  it("★ 担当者が名簿にいない案件は「その他」", () => {
    const p = build({
      customers: [customer("1", { ap: "名簿にいない人", install: "2026-11-05" })],
    });
    expect(p.events[0]?.branches).toEqual([OTHER]);
  });

  it("★ 勤務場所が空の担当者の案件は「その他」", () => {
    const p = build({
      customers: [customer("1", { ap: "担当 空", install: "2026-11-05" })],
    });
    expect(p.events[0]?.branches).toEqual([OTHER]);
  });

  it("片方が名簿にいなければ、その人の分は「その他」", () => {
    const p = build({
      customers: [
        customer("1", { ap: "担当 A", cl: "名簿にいない人", install: "2026-11-05" }),
      ],
    });
    expect(p.events[0]?.branches.sort()).toEqual([OTHER, "支店A"].sort());
  });

  it("担当者が2人とも空なら「その他」", () => {
    const p = build({
      customers: [customer("1", { ap: "", cl: "", install: "2026-11-05" })],
    });
    expect(p.events[0]?.branches).toEqual([OTHER]);
  });

  it("氏名は normApClStaffName でそろえて突き合わせる（全角空白・前後の空白）", () => {
    const p = build({
      customers: [customer("1", { ap: "　担当　A ", install: "2026-11-05" })],
    });
    expect(p.events[0]?.branches).toEqual(["支店A"]);
  });

  it("★ 支店の一覧は名簿の順で返る", () => {
    const p = build({
      rosterWorkplaces: ["支店C", "支店A", "支店B"],
      customers: [customer("1", { install: "2026-11-05" })],
    });
    expect(p.branches).toEqual(["支店C", "支店A", "支店B"]);
  });

  it("★ 「その他」は該当する予定があるときだけ一覧の末尾に入る", () => {
    const without = build({
      customers: [customer("1", { ap: "担当 A", install: "2026-11-05" })],
    });
    expect(without.branches).toEqual(["支店B", "支店A"]);

    const withOther = build({
      customers: [customer("1", { ap: "名簿にいない人", install: "2026-11-05" })],
    });
    expect(withOther.branches).toEqual(["支店B", "支店A", OTHER]);
  });

  it("月の外にしか「その他」の予定が無ければ、一覧に入れない", () => {
    const p = build({
      customers: [customer("1", { ap: "名簿にいない人", install: "2026-12-05" })],
    });
    expect(p.branches).not.toContain(OTHER);
  });

  it("ログイン中の人の勤務場所をそのまま返す", () => {
    expect(build({ selfWorkplace: "支店B" }).selfWorkplace).toBe("支店B");
    expect(build({ selfWorkplace: null }).selfWorkplace).toBeNull();
  });
});

describe("T番号 の突き合わせ", () => {
  it("★ 同じ T番号 の工事レコードが複数あれば、すべて返して印を付ける", () => {
    const p = build({
      customers: [customer("1")],
      constructionRecords: [
        construction("c1", "2026-11-10", "T-1"),
        construction("c2", "2026-11-12", "T-1"),
        construction("c3", "2026-11-14", "T-9"),
      ],
    });

    const cs = p.events.filter((e) => e.kind === "construction");
    expect(cs.map((e) => e.id)).toEqual([
      "construction:c1",
      "construction:c2",
      "construction:c3",
    ]);
    expect(cs.map((e) => e.duplicateConstructionTNumber)).toEqual([
      true,
      true,
      false,
    ]);
    expect(p.duplicateTNumberGroups.construction).toBe(1);
  });

  it("★ 同じ T番号 のお客様情報が複数あれば、すべて返し、施工予定の支店は全員の和集合", () => {
    const p = build({
      customers: [
        customer("1", { tNumber: "T-1", ap: "担当 A", install: "2026-11-05" }),
        customer("2", { tNumber: "T-1", ap: "担当 B", install: "2026-11-06" }),
      ],
      constructionRecords: [construction("c1", "2026-11-10", "T-1")],
    });

    expect(p.counts.scaffoldInstall).toBe(2);
    const c = p.events.find((e) => e.kind === "construction")!;
    expect(c.branches.sort()).toEqual(["支店A", "支店B"]);
    expect(c.duplicateCustomerTNumber).toBe(true);
    expect(p.duplicateTNumberGroups.customer).toBe(1);
  });

  it("お客様情報に無い施工予定は「その他」で返し、印を付ける", () => {
    const p = build({
      constructionRecords: [
        construction("c1", "2026-11-10", "T-無し"),
        construction("c2", "2026-11-11", ""),
      ],
    });
    expect(p.events.map((e) => e.branches)).toEqual([[OTHER], [OTHER]]);
    expect(p.events.every((e) => e.customerMatched === false)).toBe(true);
    expect(p.branches).toContain(OTHER);
  });

  it("T番号 は全角・空白の違いをそろえて突き合わせる", () => {
    const p = build({
      customers: [customer("1", { tNumber: "Ｔ-1", ap: "担当 B" })],
      constructionRecords: [construction("c1", "2026-11-10", " T-1 ")],
    });
    expect(p.events[0]?.customerMatched).toBe(true);
    expect(p.events[0]?.branches).toEqual(["支店B"]);
  });
});

describe("キャンセル", () => {
  it("キャンセルされた案件は、足場も施工予定も返さない", () => {
    const p = build({
      customers: [
        customer("1", {
          isCancelled: true,
          install: "2026-11-05",
          removal: "2026-11-25",
        }),
      ],
      constructionRecords: [construction("c1", "2026-11-10", "T-1")],
    });
    expect(p.events).toEqual([]);
  });
});

describe("件数", () => {
  it("★ 区分ごとに数える。同じお客様の3種類はそれぞれ1件", () => {
    const p = build({
      customers: [
        customer("1", { install: "2026-11-05", removal: "2026-11-25" }),
        customer("2", { install: "2026-11-06" }),
      ],
      constructionRecords: [construction("c1", "2026-11-10", "T-1")],
    });

    expect(p.counts).toEqual({
      scaffoldInstall: 2,
      scaffoldRemoval: 1,
      construction: 1,
    });
  });
});

describe("詳細表示の3つの日付", () => {
  it("★ 月の外にある日付も返る（未登録と区別できる）", () => {
    const p = build({
      customers: [
        customer("1", {
          install: "2026-10-20",
          removal: "2026-11-25",
          constructionDate: "2026-12-03",
        }),
      ],
    });

    expect(p.events).toHaveLength(1);
    expect(p.events[0]?.dates).toEqual({
      scaffoldInstall: "2026-10-20",
      construction: "2026-12-03",
      scaffoldRemoval: "2026-11-25",
    });
  });

  it("★ 未登録の日付は null", () => {
    const p = build({
      customers: [customer("1", { install: "2026-11-05" })],
    });
    expect(p.events[0]?.dates).toEqual({
      scaffoldInstall: "2026-11-05",
      construction: null,
      scaffoldRemoval: null,
    });
  });

  it("★ 施工予定日は、その月の工事レコードの値を優先する", () => {
    const p = build({
      customers: [
        customer("1", { install: "2026-11-05", constructionDate: "2026-11-30" }),
      ],
      constructionRecords: [construction("c1", "2026-11-10", "T-1")],
    });

    for (const e of p.events) {
      expect(e.dates.construction).toBe("2026-11-10");
      expect(e.dates.scaffoldInstall).toBe("2026-11-05");
    }
  });

  it("お客様情報に無い施工予定は、足場の日付が null", () => {
    const p = build({
      constructionRecords: [construction("c1", "2026-11-10", "T-無し")],
    });
    expect(p.events[0]?.dates).toEqual({
      scaffoldInstall: null,
      construction: "2026-11-10",
      scaffoldRemoval: null,
    });
  });
});

describe("空き枠（お客様名が空の工事レコード）", () => {
  it("★ お客様名が空の工事レコードは施工予定に含めない", () => {
    const p = build({
      constructionRecords: [construction("slot", "2026-11-10", "", "")],
    });
    expect(p.events).toEqual([]);
  });

  it("★ 空白だけ（半角・全角）のお客様名も空き枠として除外する", () => {
    const p = build({
      constructionRecords: [
        construction("s1", "2026-11-10", "", "   "),
        construction("s2", "2026-11-11", "", "　　"),
        construction("s3", "2026-11-12", "", " 　 "),
      ],
    });
    expect(p.events).toEqual([]);
  });

  it("★ 件数からも除外する", () => {
    const p = build({
      customers: [customer("1", { install: "2026-11-05" })],
      constructionRecords: [
        construction("slot", "2026-11-10", "", ""),
        construction("c1", "2026-11-11", "T-1"),
      ],
    });
    expect(p.counts).toEqual({
      scaffoldInstall: 1,
      scaffoldRemoval: 0,
      construction: 1,
    });
  });

  it("★ お客様名がある工事レコードは従来どおり含める", () => {
    const p = build({
      constructionRecords: [
        construction("slot", "2026-11-10", "", ""),
        construction("c1", "2026-11-10", "T-1", "お客様あり"),
      ],
    });
    expect(p.events.map((e) => e.id)).toEqual(["construction:c1"]);
    expect(p.events[0]?.customerName).toBe("お客様あり");
  });

  it("★ 足場の予定（お客様情報から作る分）には影響しない", () => {
    const p = build({
      customers: [
        customer("1", { install: "2026-11-05", removal: "2026-11-25" }),
      ],
      constructionRecords: [construction("slot", "2026-11-10", "", "")],
    });
    expect(kinds(p)).toEqual([
      "scaffoldInstall:2026-11-05",
      "scaffoldRemoval:2026-11-25",
    ]);
  });

  it("空き枠は「その他」の一覧の判定にも入らない", () => {
    const p = build({
      constructionRecords: [construction("slot", "2026-11-10", "", "")],
    });
    expect(p.branches).not.toContain(OTHER);
  });
});

describe("自分の案件の判定に使う氏名", () => {
  it("★ 足場の予定に、そのお客様の AP/CL の氏名が入る（表示値のまま）", () => {
    const p = build({
      customers: [
        customer("1", { ap: "　担当　A ", cl: "担当 B", install: "2026-11-05" }),
      ],
    });
    expect(p.events[0]?.apStaffNames).toEqual(["担当　A"]);
    expect(p.events[0]?.clStaffNames).toEqual(["担当 B"]);
  });

  it("担当者の欄が空なら空の配列", () => {
    const p = build({
      customers: [customer("1", { ap: "", cl: "", install: "2026-11-05" })],
    });
    expect(p.events[0]?.apStaffNames).toEqual([]);
    expect(p.events[0]?.clStaffNames).toEqual([]);
  });

  it("★ 施工予定は、同じ T番号 のお客様情報全員の AP/CL が入る", () => {
    const p = build({
      customers: [
        customer("1", { tNumber: "T-1", ap: "担当 A", cl: "担当 B" }),
        customer("2", { tNumber: "T-1", ap: "担当 C", cl: "担当 B" }),
      ],
      constructionRecords: [construction("c1", "2026-11-10", "T-1")],
    });
    const c = p.events.find((e) => e.kind === "construction")!;
    expect(c.apStaffNames).toEqual(["担当 A", "担当 C"]);
    expect(c.clStaffNames).toEqual(["担当 B"]);
  });

  it("お客様情報に無い施工予定は空の配列", () => {
    const p = build({
      constructionRecords: [construction("c1", "2026-11-10", "T-無し")],
    });
    expect(p.events[0]?.apStaffNames).toEqual([]);
    expect(p.events[0]?.clStaffNames).toEqual([]);
  });

  it("★ 本人の氏名を返す。無ければ null", () => {
    expect(build({ selfStaffName: "担当 A" }).selfStaffName).toBe("担当 A");
    expect(build({ selfStaffName: null }).selfStaffName).toBeNull();
    expect(build({ selfStaffName: "  " }).selfStaffName).toBeNull();
    expect(build().selfStaffName).toBeNull();
  });
});
