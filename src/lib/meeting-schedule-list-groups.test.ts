import { describe, expect, it } from "vitest";

import { groupMeetingScheduleItemsByDate } from "@/lib/meeting-schedule-list-groups";
import { filterOpenMeetingScheduleItems } from "@/lib/meeting-schedule-negotiation-status";
import type { MeetingScheduleItem } from "@/lib/meeting-schedule-types";

function item(
  over: Partial<MeetingScheduleItem> & Pick<MeetingScheduleItem, "recordId">,
): MeetingScheduleItem {
  return {
    recordId: over.recordId,
    customerName: over.customerName ?? "テスト様",
    city: "",
    meetingTime: "14:00",
    scheduledTime: "14:00",
    apoTypeLabel: "",
    estimateStatus: "商談セット作成済み",
    negotiationStatus: over.negotiationStatus ?? "商談待ち",
    meetingPlace: "",
    firstMeetingDateYmd: "",
    closeType: "",
    apPerson: "",
    clPerson: "",
    sortMinutes: 840,
    scheduledYmd: over.scheduledYmd ?? "2026-06-12",
    scheduledDateTimeYmd: over.scheduledDateTimeYmd ?? "2026-06-12",
    scheduledDateLabel: over.scheduledDateLabel ?? "6月12日（金）",
    pinpointAddress: "",
    normalAddress: "",
    responseDateYmd: "",
    responseDateLabel: "未設定",
  };
}

/** 一覧タブの実際の組み立て。絞ってからグルーピングする */
function listTab(items: MeetingScheduleItem[]) {
  const visible = filterOpenMeetingScheduleItems(items);
  return { visible, groups: groupMeetingScheduleItemsByDate(visible) };
}

describe("一覧タブの日付グルーピング", () => {
  it("日付ごとにまとめ、日付順に並べる", () => {
    const groups = groupMeetingScheduleItemsByDate([
      item({ recordId: "2", scheduledYmd: "2026-06-13", scheduledDateLabel: "6月13日（土）" }),
      item({ recordId: "1", scheduledYmd: "2026-06-12" }),
      item({ recordId: "3", scheduledYmd: "2026-06-12" }),
    ]);

    expect(groups.map((g) => g.ymd)).toEqual(["2026-06-12", "2026-06-13"]);
    expect(groups[0]?.items.map((i) => i.recordId)).toEqual(["1", "3"]);
    expect(groups[0]?.label).toBe("6月12日（金）");
  });

  it("日付未定は最後に置く", () => {
    const groups = groupMeetingScheduleItemsByDate([
      item({ recordId: "1", scheduledYmd: "", scheduledDateLabel: "日付未定" }),
      item({ recordId: "2", scheduledYmd: "2026-06-12" }),
    ]);

    expect(groups.map((g) => g.ymd)).toEqual(["2026-06-12", ""]);
    expect(groups[1]?.label).toBe("日付未定");
  });

  it("空配列ならグループも空", () => {
    expect(groupMeetingScheduleItemsByDate([])).toEqual([]);
  });
});

describe("一覧タブの絞り込みとグルーピングの組み合わせ", () => {
  it("★ 5件の商談ステータスは表示する", () => {
    const { visible } = listTab([
      item({ recordId: "1", negotiationStatus: "商談待ち" }),
      item({ recordId: "2", negotiationStatus: "返待ち" }),
      item({ recordId: "3", negotiationStatus: "資料送付回答待ち" }),
      item({ recordId: "4", negotiationStatus: "再商談" }),
      item({ recordId: "5", negotiationStatus: "再商談日調整中" }),
    ]);

    expect(visible.map((i) => i.recordId)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("★ 残り9件（結果が確定済み）は表示しない", () => {
    const { visible, groups } = listTab([
      item({ recordId: "1", negotiationStatus: "返待ち否" }),
      item({ recordId: "2", negotiationStatus: "即決成約" }),
      item({ recordId: "3", negotiationStatus: "否" }),
      item({ recordId: "4", negotiationStatus: "アポキャン" }),
      item({ recordId: "5", negotiationStatus: "再商談成約" }),
      item({ recordId: "6", negotiationStatus: "再商談否" }),
      item({ recordId: "7", negotiationStatus: "返待ち成約" }),
      item({ recordId: "8", negotiationStatus: "資料送付成約" }),
      item({ recordId: "9", negotiationStatus: "資料送付否" }),
    ]);

    expect(visible).toHaveLength(0);
    expect(groups).toEqual([]);
  });

  it("★★ 0件になった日付グループが見出しだけ残らない", () => {
    // 6/12 は全部が確定済み、6/13 だけ残る
    const { groups } = listTab([
      item({ recordId: "1", scheduledYmd: "2026-06-12", negotiationStatus: "即決成約" }),
      item({ recordId: "2", scheduledYmd: "2026-06-12", negotiationStatus: "否" }),
      item({
        recordId: "3",
        scheduledYmd: "2026-06-13",
        scheduledDateLabel: "6月13日（土）",
        negotiationStatus: "商談待ち",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.ymd).toBe("2026-06-13");
    // どのグループも空にならない
    for (const g of groups) {
      expect(g.items.length).toBeGreaterThan(0);
    }
  });

  it("★ 件数表示は絞り込み後の件数になる", () => {
    const { visible, groups } = listTab([
      item({ recordId: "1", negotiationStatus: "商談待ち" }),
      item({ recordId: "2", negotiationStatus: "即決成約" }),
      item({ recordId: "3", negotiationStatus: "再商談" }),
      item({ recordId: "4", negotiationStatus: "アポキャン" }),
    ]);

    // 画面上部の「全 N 件」
    expect(visible.length).toBe(2);
    // 日付見出しの「N件」
    expect(groups[0]?.items.length).toBe(2);
  });

  it("★ 全件除外で0件になっても壊れない", () => {
    const { visible, groups } = listTab([
      item({ recordId: "1", negotiationStatus: "即決成約" }),
      item({ recordId: "2", negotiationStatus: "アポキャン" }),
    ]);

    expect(visible).toEqual([]);
    expect(groups).toEqual([]);
  });

  it("★ 商談ステータスが空欄の案件は除外される", () => {
    const { visible } = listTab([
      item({ recordId: "1", negotiationStatus: "" }),
      item({ recordId: "2", negotiationStatus: "   " }),
      item({ recordId: "3", negotiationStatus: "商談待ち" }),
    ]);

    expect(visible.map((i) => i.recordId)).toEqual(["3"]);
  });

  it("★ 並び順は絞り込みの前後で変わらない", () => {
    const items = [
      item({ recordId: "1", scheduledYmd: "2026-06-14", scheduledDateLabel: "6月14日（日）" }),
      item({ recordId: "2", scheduledYmd: "2026-06-12", negotiationStatus: "即決成約" }),
      item({ recordId: "3", scheduledYmd: "2026-06-13", scheduledDateLabel: "6月13日（土）" }),
    ];

    const { groups } = listTab(items);
    expect(groups.map((g) => g.ymd)).toEqual(["2026-06-13", "2026-06-14"]);
  });

  it("日別タブは絞り込まない（同じ items をそのまま使う）", () => {
    const items = [
      item({ recordId: "1", negotiationStatus: "即決成約" }),
      item({ recordId: "2", negotiationStatus: "商談待ち" }),
    ];

    // 日別タブは filterOpenMeetingScheduleItems を通さない
    expect(items).toHaveLength(2);
    expect(filterOpenMeetingScheduleItems(items)).toHaveLength(1);
  });
});
