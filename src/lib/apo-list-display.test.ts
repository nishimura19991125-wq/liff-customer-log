import { describe, expect, it } from "vitest";

import {
  formatApoListScheduledDateTime,
  groupApoListRowsByDate,
  APO_LIST_UNDATED_LABEL,
} from "@/lib/apo-list-display";
import { filterApoListRows } from "@/lib/apo-list-filter";
import type { ApoListRow } from "@/lib/apo-list-types";

function row(over: Partial<ApoListRow> = {}): ApoListRow {
  return {
    recordId: over.recordId ?? "1",
    scheduledYmd: over.scheduledYmd ?? "2026-06-12",
    scheduledTime: over.scheduledTime ?? "14:00",
    scheduledDateLabel: over.scheduledDateLabel ?? "6月12日（金）",
    customerName: over.customerName ?? "テスト様",
    city: over.city ?? "生駒市",
    apoTypeLabel: over.apoTypeLabel ?? "DC案件",
    estimateStatus: over.estimateStatus ?? "見積依頼済み",
    negotiationStatus: over.negotiationStatus ?? "商談待ち",
  };
}

describe("商談・資料送付予定日時の表示", () => {
  it("★ 日付＋時刻で出す", () => {
    expect(
      formatApoListScheduledDateTime({
        scheduledYmd: "2026-06-12",
        scheduledTime: "14:00",
      }),
    ).toBe("2026/06/12 14:00");
  });

  it("★ 時刻が空なら日付だけ（埋め草を入れない）", () => {
    expect(
      formatApoListScheduledDateTime({
        scheduledYmd: "2026-06-12",
        scheduledTime: "",
      }),
    ).toBe("2026/06/12");
    expect(
      formatApoListScheduledDateTime({
        scheduledYmd: "2026-06-12",
        scheduledTime: "   ",
      }),
    ).toBe("2026/06/12");
  });

  it("★ 日付が空なら「日付未定」", () => {
    expect(
      formatApoListScheduledDateTime({ scheduledYmd: "", scheduledTime: "" }),
    ).toBe(APO_LIST_UNDATED_LABEL);
    // 時刻だけあっても日付が無ければ日付未定
    expect(
      formatApoListScheduledDateTime({
        scheduledYmd: "",
        scheduledTime: "14:00",
      }),
    ).toBe(APO_LIST_UNDATED_LABEL);
  });

  it("月日はゼロ埋めする", () => {
    expect(
      formatApoListScheduledDateTime({
        scheduledYmd: "2026-01-05",
        scheduledTime: "09:00",
      }),
    ).toBe("2026/01/05 09:00");
  });
});

describe("アポ情報一覧の日付グルーピング", () => {
  it("★ 日付ごとにまとめ、日付順に並べる", () => {
    const groups = groupApoListRowsByDate([
      row({ recordId: "2", scheduledYmd: "2026-06-13", scheduledDateLabel: "6月13日（土）" }),
      row({ recordId: "1", scheduledYmd: "2026-06-12" }),
      row({ recordId: "3", scheduledYmd: "2026-06-12" }),
    ]);

    expect(groups.map((g) => g.ymd)).toEqual(["2026-06-12", "2026-06-13"]);
    expect(groups[0]?.label).toBe("6月12日（金）");
  });

  it("★ 各グループの件数が正しい", () => {
    const groups = groupApoListRowsByDate([
      row({ recordId: "1", scheduledYmd: "2026-06-12" }),
      row({ recordId: "2", scheduledYmd: "2026-06-12" }),
      row({ recordId: "3", scheduledYmd: "2026-06-13", scheduledDateLabel: "6月13日（土）" }),
    ]);

    expect(groups[0]?.items).toHaveLength(2);
    expect(groups[1]?.items).toHaveLength(1);
  });

  it("★ 日付未定は最後に置く", () => {
    const groups = groupApoListRowsByDate([
      row({
        recordId: "1",
        scheduledYmd: "",
        scheduledDateLabel: APO_LIST_UNDATED_LABEL,
      }),
      row({ recordId: "2", scheduledYmd: "2026-06-12" }),
    ]);

    expect(groups.map((g) => g.ymd)).toEqual(["2026-06-12", ""]);
    expect(groups[1]?.label).toBe(APO_LIST_UNDATED_LABEL);
  });

  it("★ 0件ならグループも空", () => {
    expect(groupApoListRowsByDate([])).toEqual([]);
  });

  it("★★ 絞り込んでからグループ化すれば、空の見出しは残らない", () => {
    const all = [
      // 6/12 は全部が確定済み。絞り込みで消える
      row({ recordId: "1", scheduledYmd: "2026-06-12", negotiationStatus: "即決成約" }),
      row({ recordId: "2", scheduledYmd: "2026-06-12", negotiationStatus: "否" }),
      row({
        recordId: "3",
        scheduledYmd: "2026-06-13",
        scheduledDateLabel: "6月13日（土）",
        negotiationStatus: "商談待ち",
      }),
    ];

    const groups = groupApoListRowsByDate(filterApoListRows(all, "open"));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.ymd).toBe("2026-06-13");
    for (const g of groups) {
      expect(g.items.length).toBeGreaterThan(0);
    }
  });

  it("★ 全件が絞り込まれたらグループも0件", () => {
    const all = [
      row({ recordId: "1", negotiationStatus: "即決成約" }),
      row({ recordId: "2", negotiationStatus: "アポキャン" }),
    ];
    expect(groupApoListRowsByDate(filterApoListRows(all, "open"))).toEqual([]);
  });

  it("「すべて」なら確定済みも含めてグループ化される", () => {
    const all = [
      row({ recordId: "1", negotiationStatus: "即決成約" }),
      row({ recordId: "2", negotiationStatus: "商談待ち" }),
    ];
    const groups = groupApoListRowsByDate(filterApoListRows(all, "all"));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toHaveLength(2);
  });
});

describe("行が持つ項目", () => {
  it("★ バッジ3種の値を持つ", () => {
    const r = row();
    expect(r.city).toBe("生駒市");
    expect(r.apoTypeLabel).toBe("DC案件");
    expect(r.estimateStatus).toBe("見積依頼済み");
  });

  it("★ AP担当者・CL担当者は持たない（表示しないため）", () => {
    const keys = Object.keys(row());
    expect(keys).not.toContain("apPerson");
    expect(keys).not.toContain("clPerson");
    expect(keys).not.toContain("apStaff");
    expect(keys).not.toContain("clStaff");
  });

  it("★ 各項目が空でも壊れない", () => {
    const empty = row({
      customerName: "",
      city: "",
      apoTypeLabel: "",
      estimateStatus: "",
      scheduledYmd: "",
      scheduledTime: "",
      scheduledDateLabel: "",
    });
    expect(() => groupApoListRowsByDate([empty])).not.toThrow();
    expect(formatApoListScheduledDateTime(empty)).toBe(APO_LIST_UNDATED_LABEL);
    // 見出しが空でも「日付未定」で埋める
    expect(groupApoListRowsByDate([empty])[0]?.label).toBe(
      APO_LIST_UNDATED_LABEL,
    );
  });
});
