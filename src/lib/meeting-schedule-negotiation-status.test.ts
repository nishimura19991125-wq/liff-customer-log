import { describe, expect, it } from "vitest";

import {
  keepsMeetingScheduleAlert,
  meetingScheduleNegotiationConfirmMessage,
  needsMeetingScheduleNegotiationConfirm,
  normalizeSelectableNegotiationStatus,
  MEETING_SCHEDULE_NEGOTIATION_STATUS_OPTIONS,
} from "@/lib/meeting-schedule-negotiation-status";
import { filterPendingMeetingAlerts } from "@/lib/meeting-schedule-pending-set-created-client";
import type { MeetingScheduleItem } from "@/lib/meeting-schedule-types";

/** @pocket 側の実際の選択肢14件 */
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

function item(negotiationStatus: string): MeetingScheduleItem {
  return {
    recordId: "1",
    customerName: "テスト",
    city: "",
    meetingTime: "",
    scheduledTime: "",
    apoTypeLabel: "",
    estimateStatus: "商談セット作成済み",
    negotiationStatus,
    meetingPlace: "",
    firstMeetingDateYmd: "",
    closeType: "",
    apPerson: "",
    clPerson: "",
    sortMinutes: 0,
    scheduledYmd: "2026-09-05",
    scheduledDateLabel: "9/5",
    pinpointAddress: "",
    normalAddress: "",
    responseDateYmd: "",
    responseDateLabel: "",
  };
}

describe("LIFF から選べる商談ステータス", () => {
  it("6件だけ。@pocket の14件の部分集合である", () => {
    expect(MEETING_SCHEDULE_NEGOTIATION_STATUS_OPTIONS).toEqual([
      "商談待ち",
      "即決成約",
      "再商談",
      "返待ち",
      "否",
      "アポキャン",
    ]);
    for (const opt of MEETING_SCHEDULE_NEGOTIATION_STATUS_OPTIONS) {
      expect(POCKET_STATUSES).toContain(opt);
    }
  });

  it("6件は選べる", () => {
    for (const opt of MEETING_SCHEDULE_NEGOTIATION_STATUS_OPTIONS) {
      expect(normalizeSelectableNegotiationStatus(opt)).toBe(opt);
    }
  });

  it("6件の外は選べない（資料送付成約など）", () => {
    const outside = POCKET_STATUSES.filter(
      (s) => !MEETING_SCHEDULE_NEGOTIATION_STATUS_OPTIONS.includes(s),
    );
    expect(outside.length).toBeGreaterThan(0);
    for (const s of outside) {
      expect(normalizeSelectableNegotiationStatus(s)).toBeNull();
    }
  });

  it("空欄・未知の値も選べない", () => {
    expect(normalizeSelectableNegotiationStatus("")).toBeNull();
    expect(normalizeSelectableNegotiationStatus("   ")).toBeNull();
    expect(normalizeSelectableNegotiationStatus("存在しない")).toBeNull();
  });

  it("全角・前後の空白のゆれは吸収する", () => {
    expect(normalizeSelectableNegotiationStatus(" 商談待ち ")).toBe("商談待ち");
    expect(normalizeSelectableNegotiationStatus("アポキャン")).toBe("アポキャン");
  });
});

describe("確認ダイアログを出すか", () => {
  it("即決成約・否・アポキャン・返待ちでは出す", () => {
    for (const s of ["即決成約", "否", "アポキャン", "返待ち"]) {
      expect(needsMeetingScheduleNegotiationConfirm(s)).toBe(true);
    }
  });

  it("商談待ち・再商談では出さない", () => {
    for (const s of ["商談待ち", "再商談"]) {
      expect(needsMeetingScheduleNegotiationConfirm(s)).toBe(false);
    }
  });

  it("空欄では出さない", () => {
    expect(needsMeetingScheduleNegotiationConfirm("")).toBe(false);
  });

  /**
   * 二重管理の防止。
   * 判定を書き写すのではなく filterPendingMeetingAlerts と同じ関数を
   * 参照しているので、@pocket の全14件で両者が一致するはず。
   * ずれたらどちらかを直したときにここが落ちる
   */
  it("★ アラートの実際の判定と一致する（@pocket の全14件）", () => {
    for (const s of POCKET_STATUSES) {
      const staysInAlert = filterPendingMeetingAlerts([item(s)]).length > 0;
      expect(keepsMeetingScheduleAlert(s)).toBe(staysInAlert);
      expect(needsMeetingScheduleNegotiationConfirm(s)).toBe(!staysInAlert);
    }
  });
});

describe("確認ダイアログの本文", () => {
  it("変更後の値とアラートから消える旨を書く", () => {
    const msg = meetingScheduleNegotiationConfirmMessage("否");
    expect(msg).toContain("商談ステータスを「否」に変更します");
    expect(msg).toContain("出勤後の入力アラートに表示されなくなります");
  });

  it("「元に戻せません」とは書かない（商談待ちに戻せるため）", () => {
    for (const s of ["即決成約", "否", "アポキャン", "返待ち"]) {
      expect(meetingScheduleNegotiationConfirmMessage(s)).not.toContain(
        "元に戻せません",
      );
    }
  });
});
