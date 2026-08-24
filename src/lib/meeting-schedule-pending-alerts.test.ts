import { describe, expect, it } from "vitest";

import { filterPendingMeetingAlerts } from "@/lib/meeting-schedule-pending-set-created-client";
import type { MeetingScheduleItem } from "@/lib/meeting-schedule-types";

function item(
  over: Partial<MeetingScheduleItem> & Pick<MeetingScheduleItem, "recordId">,
): MeetingScheduleItem {
  return {
    recordId: over.recordId,
    customerName: over.customerName ?? "テスト様",
    city: over.city ?? "生駒市",
    meetingTime: over.meetingTime ?? "14:00",
    scheduledTime: over.scheduledTime ?? "14:00",
    apoTypeLabel: over.apoTypeLabel ?? "",
    estimateStatus: over.estimateStatus ?? "商談セット作成済み",
    negotiationStatus: over.negotiationStatus ?? "",
    meetingPlace: over.meetingPlace ?? "",
    firstMeetingDateYmd: over.firstMeetingDateYmd ?? "",
    closeType: over.closeType ?? "",
    apPerson: over.apPerson ?? "",
    clPerson: over.clPerson ?? "",
    sortMinutes: over.sortMinutes ?? 840,
    scheduledYmd: over.scheduledYmd ?? "2026-06-12",
    scheduledDateLabel: over.scheduledDateLabel ?? "6月12日（金）",
    pinpointAddress: over.pinpointAddress ?? "",
    normalAddress: over.normalAddress ?? "",
    responseDateYmd: over.responseDateYmd ?? "",
    responseDateLabel: over.responseDateLabel ?? "未設定",
  };
}

describe("filterPendingMeetingAlerts", () => {
  it("商談ステータスが商談待ちの案件を表示する", () => {
    const alerts = filterPendingMeetingAlerts([
      item({
        recordId: "1",
        negotiationStatus: "商談待ち",
        estimateStatus: "見積依頼済み",
      }),
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.alertKind).toBe("waiting");
  });

  it("商談ステータスが再商談の案件を表示する", () => {
    const alerts = filterPendingMeetingAlerts([
      item({
        recordId: "2",
        negotiationStatus: "再商談",
      }),
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.alertKind).toBe("re-negotiation");
  });

  it("見積ステータスだけでは表示しない", () => {
    const alerts = filterPendingMeetingAlerts([
      item({
        recordId: "3",
        estimateStatus: "商談セット作成済み",
        negotiationStatus: "",
      }),
    ]);
    expect(alerts).toHaveLength(0);
  });

  it("再商談否・再商談成約は除外する", () => {
    const alerts = filterPendingMeetingAlerts([
      item({ recordId: "4", negotiationStatus: "再商談否" }),
      item({ recordId: "5", negotiationStatus: "再商談成約" }),
    ]);
    expect(alerts).toHaveLength(0);
  });
});
