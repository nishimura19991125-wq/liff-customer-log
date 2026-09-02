import { describe, expect, it } from "vitest";

import { apoListRowToCardValues } from "@/lib/apo-list-card-values";
import type { ApoListRow } from "@/lib/apo-list-types";

function row(overrides: Partial<ApoListRow> = {}): ApoListRow {
  return {
    recordId: "1",
    scheduledYmd: "2026-06-12",
    scheduledTime: "13:30",
    scheduledDateLabel: "6月12日（金）",
    customerName: "山田太郎",
    city: "松山市",
    apoTypeLabel: "DC案件",
    estimateStatus: "商談セット作成済み",
    giftCoupon: "有",
    negotiationStatus: "商談前",
    dropboxUrl: "https://example.com/a",
    firstMeetingDateYmd: "2026-06-20",
    closeType: "両クロ",
    meetingPlace: "自宅",
    responseDateYmd: "2026-06-25",
    ...overrides,
  };
}

describe("apoListRowToCardValues", () => {
  it("8項目をそのまま移す", () => {
    expect(apoListRowToCardValues(row())).toEqual({
      estimateStatus: "商談セット作成済み",
      scheduledYmd: "2026-06-12",
      scheduledTime: "13:30",
      meetingDate: "2026-06-20",
      closeType: "両クロ",
      meetingPlace: "自宅",
      responseDate: "2026-06-25",
      negotiationStatus: "商談前",
    });
  });

  it("名前が変わるのは初回商談実施日と返待ち回答日の2つだけ", () => {
    const v = apoListRowToCardValues(
      row({ firstMeetingDateYmd: "2026-01-02", responseDateYmd: "2026-03-04" }),
    );
    expect(v.meetingDate).toBe("2026-01-02");
    expect(v.responseDate).toBe("2026-03-04");
  });

  it("未設定は空文字のまま。既定値で埋めない", () => {
    const v = apoListRowToCardValues(
      row({
        estimateStatus: "",
        scheduledYmd: "",
        scheduledTime: "",
        firstMeetingDateYmd: "",
        closeType: "",
        meetingPlace: "",
        responseDateYmd: "",
        negotiationStatus: "",
      }),
    );
    expect(Object.values(v)).toEqual(["", "", "", "", "", "", "", ""]);
  });

  it("表示専用の項目（お客様名・日付見出し・ギフト券）は混ざらない", () => {
    const v = apoListRowToCardValues(row()) as Record<string, unknown>;
    expect(Object.keys(v).sort()).toEqual(
      [
        "closeType",
        "estimateStatus",
        "meetingDate",
        "meetingPlace",
        "negotiationStatus",
        "responseDate",
        "scheduledTime",
        "scheduledYmd",
      ].sort(),
    );
  });

  it("元の行を書き換えない", () => {
    const original = row();
    const snapshot = { ...original };
    apoListRowToCardValues(original);
    expect(original).toEqual(snapshot);
  });
});
