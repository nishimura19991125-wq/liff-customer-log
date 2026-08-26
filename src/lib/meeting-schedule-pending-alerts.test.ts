import { describe, expect, it } from "vitest";

import { filterPendingMeetingAlerts } from "@/lib/meeting-schedule-pending-set-created-client";
import { isMeetingScheduleAlertOverdue } from "@/lib/meeting-schedule-shared";
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
    scheduledDateTimeYmd:
      over.scheduledDateTimeYmd ?? over.scheduledYmd ?? "2026-06-12",
    scheduledDateLabel: over.scheduledDateLabel ?? "6月12日（金）",
    pinpointAddress: over.pinpointAddress ?? "",
    normalAddress: over.normalAddress ?? "",
    responseDateYmd: over.responseDateYmd ?? "",
    responseDateLabel: over.responseDateLabel ?? "未設定",
  };
}

/**
 * 「今日」を固定する。日付条件が入ったので、実時刻に依存させない
 * （既定の予定日 2026-06-12 はこの日より前＝アラート対象）
 */
const TODAY = "2026-08-26";

describe("filterPendingMeetingAlerts", () => {
  it("商談ステータスが商談待ちの案件を表示する", () => {
    const alerts = filterPendingMeetingAlerts([
      item({
        recordId: "1",
        negotiationStatus: "商談待ち",
        estimateStatus: "見積依頼済み",
      }),
    ], TODAY);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.alertKind).toBe("waiting");
  });

  it("商談ステータスが再商談の案件を表示する", () => {
    const alerts = filterPendingMeetingAlerts([
      item({
        recordId: "2",
        negotiationStatus: "再商談",
      }),
    ], TODAY);
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
    ], TODAY);
    expect(alerts).toHaveLength(0);
  });

  it("再商談否・再商談成約は除外する", () => {
    const alerts = filterPendingMeetingAlerts([
      item({ recordId: "4", negotiationStatus: "再商談否" }),
      item({ recordId: "5", negotiationStatus: "再商談成約" }),
    ], TODAY);
    expect(alerts).toHaveLength(0);
  });
});

/**
 * 日付条件（商談・資料送付予定日時が今日より前）。
 * 商談ステータスの条件と AND で効く。
 */
describe("filterPendingMeetingAlerts の日付条件", () => {
  const waiting = (over: Partial<MeetingScheduleItem>) =>
    item({ recordId: "1", negotiationStatus: "商談待ち", ...over });

  it("★ 昨日以前なら出す", () => {
    expect(
      filterPendingMeetingAlerts(
        [waiting({ scheduledDateTimeYmd: "2026-08-25" })],
        TODAY,
      ),
    ).toHaveLength(1);
    expect(
      filterPendingMeetingAlerts(
        [waiting({ scheduledDateTimeYmd: "2026-01-05" })],
        TODAY,
      ),
    ).toHaveLength(1);
  });

  it("★ 今日は出さない（時刻は見ない）", () => {
    // 今日 14:00 の案件。時刻を過ぎていても対象外
    expect(
      filterPendingMeetingAlerts(
        [waiting({ scheduledDateTimeYmd: TODAY, scheduledTime: "14:00" })],
        TODAY,
      ),
    ).toHaveLength(0);
    expect(
      filterPendingMeetingAlerts(
        [waiting({ scheduledDateTimeYmd: TODAY, scheduledTime: "00:00" })],
        TODAY,
      ),
    ).toHaveLength(0);
  });

  it("★ 明日以降は出さない", () => {
    expect(
      filterPendingMeetingAlerts(
        [waiting({ scheduledDateTimeYmd: "2026-08-27" })],
        TODAY,
      ),
    ).toHaveLength(0);
    expect(
      filterPendingMeetingAlerts(
        [waiting({ scheduledDateTimeYmd: "2027-01-05" })],
        TODAY,
      ),
    ).toHaveLength(0);
  });

  it("★ 予定日時が空欄なら出さない", () => {
    expect(
      filterPendingMeetingAlerts(
        [waiting({ scheduledDateTimeYmd: "" })],
        TODAY,
      ),
    ).toHaveLength(0);
    expect(
      filterPendingMeetingAlerts(
        [waiting({ scheduledDateTimeYmd: "   " })],
        TODAY,
      ),
    ).toHaveLength(0);
  });

  it("★ 商談ステータスが対象外なら、昨日以前でも出さない", () => {
    for (const status of ["即決成約", "否", "アポキャン", "返待ち", "資料送付回答待ち", ""]) {
      expect(
        filterPendingMeetingAlerts(
          [waiting({ negotiationStatus: status, scheduledDateTimeYmd: "2026-08-25" })],
          TODAY,
        ),
        status,
      ).toHaveLength(0);
    }
  });

  it("★ 日付をまたぐ境界（前日 23:59 / 当日 00:00）で誤判定しない", () => {
    // 前日 23:59 → 出す
    expect(
      filterPendingMeetingAlerts(
        [
          waiting({
            scheduledDateTimeYmd: "2026-08-25",
            scheduledTime: "23:59",
          }),
        ],
        TODAY,
      ),
    ).toHaveLength(1);

    // 当日 00:00 → 出さない
    expect(
      filterPendingMeetingAlerts(
        [waiting({ scheduledDateTimeYmd: TODAY, scheduledTime: "00:00" })],
        TODAY,
      ),
    ).toHaveLength(0);
  });

  it("★ 初回商談実施日では判定しない", () => {
    // 商談・資料送付予定日時は空。初回商談実施日だけが昨日以前
    expect(
      filterPendingMeetingAlerts(
        [
          waiting({
            scheduledDateTimeYmd: "",
            firstMeetingDateYmd: "2026-01-05",
            // scheduledYmd は初回商談実施日で埋まることがあるが、見ない
            scheduledYmd: "2026-01-05",
          }),
        ],
        TODAY,
      ),
    ).toHaveLength(0);
  });

  it("alertKind は従来どおり付く", () => {
    const alerts = filterPendingMeetingAlerts(
      [
        waiting({ recordId: "1", scheduledDateTimeYmd: "2026-08-25" }),
        item({
          recordId: "2",
          negotiationStatus: "再商談",
          scheduledDateTimeYmd: "2026-08-24",
        }),
      ],
      TODAY,
    );
    expect(alerts.map((a) => a.alertKind)).toEqual(["waiting", "re-negotiation"]);
  });
});

describe("isMeetingScheduleAlertOverdue", () => {
  it("★ 形式ゆれを吸収する", () => {
    for (const raw of [
      "2026-08-25",
      "2026/08/25",
      "2026/08/25 00:00:00",
      "2026-08-25 23:59",
      "2026-8-25",
      "2026-08-25T10:00:00",
      " 2026-08-25 ",
    ]) {
      expect(isMeetingScheduleAlertOverdue(raw, TODAY), raw).toBe(true);
    }
  });

  it("形式ゆれのある「今日」でも今日は出さない", () => {
    for (const raw of ["2026-08-26", "2026/08/26", "2026/08/26 14:00:00"]) {
      expect(isMeetingScheduleAlertOverdue(raw, TODAY), raw).toBe(false);
    }
  });

  it("空欄・解釈できない値は false（＝出さない）", () => {
    for (const raw of ["", "   ", "未定", "2026-13-99x"]) {
      expect(isMeetingScheduleAlertOverdue(raw, TODAY), raw).toBe(false);
    }
  });

  it("今日が空・不正なら false（誤って全件出さない）", () => {
    expect(isMeetingScheduleAlertOverdue("2026-08-25", "")).toBe(false);
    expect(isMeetingScheduleAlertOverdue("2026-08-25", "不正")).toBe(false);
  });

  it("月・年をまたぐ比較が正しい", () => {
    expect(isMeetingScheduleAlertOverdue("2026-07-31", "2026-08-01")).toBe(true);
    expect(isMeetingScheduleAlertOverdue("2025-12-31", "2026-01-01")).toBe(true);
    expect(isMeetingScheduleAlertOverdue("2026-08-01", "2026-07-31")).toBe(false);
    expect(isMeetingScheduleAlertOverdue("2026-01-01", "2025-12-31")).toBe(false);
  });
});
