import { describe, expect, it } from "vitest";

import {
  filterApoListRows,
  isApoListScope,
  APO_LIST_SCOPES,
  APO_LIST_SCOPE_LABELS,
} from "@/lib/apo-list-filter";
import { isMeetingScheduleNegotiationOpen } from "@/lib/meeting-schedule-negotiation-status";
import type { ApoListRow } from "@/lib/apo-list-types";

/** @pocket 側の商談ステータス選択肢14件 */
const POCKET_STATUSES = [
  "商談待ち",
  "即決成約",
  "再商談",
  "返待ち",
  "再商談成約",
  "返待ち成約",
  "否",
  "再商談否",
  "返待ち否",
  "資料送付回答待ち",
  "資料送付成約",
  "資料送付否",
  "アポキャン",
  "再商談日調整中",
];

/** 仕様: 「進行中」で出す5件 */
const OPEN = [
  "商談待ち",
  "返待ち",
  "資料送付回答待ち",
  "再商談",
  "再商談日調整中",
];

function row(over: Partial<ApoListRow> = {}): ApoListRow {
  return {
    recordId: over.recordId ?? "1",
    scheduledTime: over.scheduledTime ?? "14:00",
    customerName: over.customerName ?? "テスト様",
    city: over.city ?? "生駒市",
    estimateStatus: over.estimateStatus ?? "見積依頼済み",
    negotiationStatus: over.negotiationStatus ?? "商談待ち",
  };
}

const ALL_ROWS = POCKET_STATUSES.map((s, i) =>
  row({ recordId: String(i + 1), negotiationStatus: s }),
);

describe("アポ情報一覧の絞り込み", () => {
  it("切り替えは2択（進行中／すべて）", () => {
    expect(APO_LIST_SCOPES).toEqual(["open", "all"]);
    expect(APO_LIST_SCOPE_LABELS.open).toBe("進行中");
    expect(APO_LIST_SCOPE_LABELS.all).toBe("すべて");
  });

  it("★ 進行中は5件の商談ステータスだけ通す", () => {
    const filtered = filterApoListRows(ALL_ROWS, "open");
    expect(filtered.map((r) => r.negotiationStatus).sort()).toEqual(
      [...OPEN].sort(),
    );
  });

  it("★ 進行中では残り9件（結果が確定済み）を通さない", () => {
    const filtered = filterApoListRows(ALL_ROWS, "open");
    for (const s of POCKET_STATUSES.filter((x) => !OPEN.includes(x))) {
      expect(filtered.some((r) => r.negotiationStatus === s), s).toBe(false);
    }
  });

  it("★ すべては絞り込まない（14件そのまま）", () => {
    expect(filterApoListRows(ALL_ROWS, "all")).toHaveLength(14);
  });

  it("★ 判定は isMeetingScheduleNegotiationOpen と一致する（リストを二重に持たない）", () => {
    const filtered = filterApoListRows(ALL_ROWS, "open");
    for (const r of ALL_ROWS) {
      const shown = filtered.some((f) => f.recordId === r.recordId);
      expect(shown, r.negotiationStatus).toBe(
        isMeetingScheduleNegotiationOpen(r.negotiationStatus),
      );
    }
  });

  it("★ 商談ステータスが空欄・未知の値は進行中に出さない", () => {
    const rows = [
      row({ recordId: "1", negotiationStatus: "" }),
      row({ recordId: "2", negotiationStatus: "   " }),
      row({ recordId: "3", negotiationStatus: "未知のステータス" }),
    ];
    expect(filterApoListRows(rows, "open")).toEqual([]);
    // 「すべて」なら残る
    expect(filterApoListRows(rows, "all")).toHaveLength(3);
  });

  it("★ 0件でも壊れない（進行中・すべてとも）", () => {
    expect(filterApoListRows([], "open")).toEqual([]);
    expect(filterApoListRows([], "all")).toEqual([]);
  });

  it("★ 全件が確定済みなら進行中は0件になる", () => {
    const rows = [
      row({ recordId: "1", negotiationStatus: "即決成約" }),
      row({ recordId: "2", negotiationStatus: "アポキャン" }),
    ];
    expect(filterApoListRows(rows, "open")).toEqual([]);
    expect(filterApoListRows(rows, "all")).toHaveLength(2);
  });

  it("元の配列を書き換えない", () => {
    const rows = [...ALL_ROWS];
    filterApoListRows(rows, "open");
    filterApoListRows(rows, "all");
    expect(rows).toHaveLength(14);
  });

  it("並び順は入力のまま保つ", () => {
    const filtered = filterApoListRows(ALL_ROWS, "open");
    const ids = filtered.map((r) => Number(r.recordId));
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });

  it("isApoListScope は2択だけ受ける", () => {
    expect(isApoListScope("open")).toBe(true);
    expect(isApoListScope("all")).toBe(true);
    expect(isApoListScope("")).toBe(false);
    expect(isApoListScope("未知")).toBe(false);
  });
});
