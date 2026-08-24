import { describe, expect, it } from "vitest";

import {
  canEditMeetingScheduleNegotiationStatus,
  canTransitionMeetingScheduleNegotiationStatus,
  keepsMeetingScheduleAlert,
  meetingScheduleNegotiationConfirmMessage,
  meetingScheduleNegotiationOptionsFor,
  needsMeetingScheduleNegotiationConfirm,
  normalizeMeetingScheduleNegotiationStatus,
  MEETING_SCHEDULE_NEGOTIATION_STATUSES,
} from "@/lib/meeting-schedule-negotiation-status";
import { filterPendingMeetingAlerts } from "@/lib/meeting-schedule-pending-set-created-client";
import type { MeetingScheduleItem } from "@/lib/meeting-schedule-types";

/** 仕様の遷移ルールをそのまま書き下したもの（実装とは別に持つ） */
const EXPECTED_TRANSITIONS: Record<string, string[]> = {
  商談待ち: ["商談待ち", "即決成約", "再商談", "返待ち", "否", "アポキャン"],
  再商談: ["再商談", "再商談成約", "再商談否", "再商談日調整中", "返待ち"],
  返待ち: ["返待ち", "返待ち成約", "返待ち否", "再商談"],
  資料送付回答待ち: ["資料送付回答待ち", "資料送付成約", "資料送付否", "再商談"],
  再商談日調整中: ["再商談日調整中", "再商談", "再商談成約", "再商談否", "返待ち"],
  即決成約: [],
  再商談成約: [],
  返待ち成約: [],
  否: [],
  再商談否: [],
  返待ち否: [],
  アポキャン: [],
  資料送付成約: [],
  資料送付否: [],
};

/** 変更不可の9件 */
const TERMINAL = Object.keys(EXPECTED_TRANSITIONS).filter(
  (s) => EXPECTED_TRANSITIONS[s].length === 0,
);

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

describe("商談ステータスの遷移ルール", () => {
  it("@pocket の選択肢は14件で全て", () => {
    expect(MEETING_SCHEDULE_NEGOTIATION_STATUSES).toHaveLength(14);
    expect([...MEETING_SCHEDULE_NEGOTIATION_STATUSES].sort()).toEqual(
      Object.keys(EXPECTED_TRANSITIONS).sort(),
    );
  });

  it("★ 14件それぞれで選べる値が仕様どおり", () => {
    for (const current of MEETING_SCHEDULE_NEGOTIATION_STATUSES) {
      expect(meetingScheduleNegotiationOptionsFor(current)).toEqual(
        EXPECTED_TRANSITIONS[current],
      );
    }
  });

  it("★ 変更できる5件は、現在値が選択肢の先頭に入る", () => {
    const editable = MEETING_SCHEDULE_NEGOTIATION_STATUSES.filter((s) =>
      canEditMeetingScheduleNegotiationStatus(s),
    );
    expect(editable).toHaveLength(5);
    for (const current of editable) {
      expect(meetingScheduleNegotiationOptionsFor(current)[0]).toBe(current);
    }
  });

  it("★ 変更不可の9件は選択肢が空（＝選択欄を出さない）", () => {
    expect(TERMINAL).toHaveLength(9);
    for (const current of TERMINAL) {
      expect(meetingScheduleNegotiationOptionsFor(current)).toEqual([]);
      expect(canEditMeetingScheduleNegotiationStatus(current)).toBe(false);
    }
  });

  it("遷移先はすべて14件の中に収まっている", () => {
    for (const current of MEETING_SCHEDULE_NEGOTIATION_STATUSES) {
      for (const next of meetingScheduleNegotiationOptionsFor(current)) {
        expect(MEETING_SCHEDULE_NEGOTIATION_STATUSES).toContain(next);
      }
    }
  });

  it("★ 14件の外・空欄でも壊れない（変更不可扱い）", () => {
    for (const s of ["", "   ", "存在しないステータス", "商談中"]) {
      expect(meetingScheduleNegotiationOptionsFor(s)).toEqual([]);
      expect(canEditMeetingScheduleNegotiationStatus(s)).toBe(false);
      expect(normalizeMeetingScheduleNegotiationStatus(s)).toBeNull();
    }
  });

  it("前後の空白のゆれは吸収する", () => {
    expect(normalizeMeetingScheduleNegotiationStatus(" 商談待ち ")).toBe(
      "商談待ち",
    );
    expect(meetingScheduleNegotiationOptionsFor(" 返待ち ")).toEqual(
      EXPECTED_TRANSITIONS["返待ち"],
    );
  });
});

describe("遷移できるかの判定（サーバ側の検証に使う）", () => {
  it("仕様どおりの遷移だけ許す", () => {
    for (const current of MEETING_SCHEDULE_NEGOTIATION_STATUSES) {
      for (const next of MEETING_SCHEDULE_NEGOTIATION_STATUSES) {
        expect(
          canTransitionMeetingScheduleNegotiationStatus(current, next),
        ).toBe(EXPECTED_TRANSITIONS[current].includes(next));
      }
    }
  });

  it("変更不可の9件からはどこへも遷移できない", () => {
    for (const current of TERMINAL) {
      for (const next of MEETING_SCHEDULE_NEGOTIATION_STATUSES) {
        expect(
          canTransitionMeetingScheduleNegotiationStatus(current, next),
        ).toBe(false);
      }
    }
  });

  it("14件の外の値は行き先にも出発点にもできない", () => {
    expect(
      canTransitionMeetingScheduleNegotiationStatus("商談待ち", "存在しない"),
    ).toBe(false);
    expect(
      canTransitionMeetingScheduleNegotiationStatus("存在しない", "商談待ち"),
    ).toBe(false);
    expect(canTransitionMeetingScheduleNegotiationStatus("", "商談待ち")).toBe(
      false,
    );
  });

  it("商談待ちから再商談成約のような飛び越しは許さない", () => {
    expect(
      canTransitionMeetingScheduleNegotiationStatus("商談待ち", "再商談成約"),
    ).toBe(false);
    expect(
      canTransitionMeetingScheduleNegotiationStatus("返待ち", "即決成約"),
    ).toBe(false);
  });
});

describe("確認ダイアログを出すか", () => {
  it("★ 現在値のまま保存するときは出さない", () => {
    for (const s of MEETING_SCHEDULE_NEGOTIATION_STATUSES) {
      expect(needsMeetingScheduleNegotiationConfirm(s, s)).toBe(false);
    }
  });

  it("アラートに残る値へ変更するときは出さない", () => {
    expect(needsMeetingScheduleNegotiationConfirm("商談待ち", "再商談")).toBe(
      false,
    );
    expect(needsMeetingScheduleNegotiationConfirm("返待ち", "再商談")).toBe(
      false,
    );
    // 再商談日調整中も filterPendingMeetingAlerts 上はアラート対象
    expect(
      needsMeetingScheduleNegotiationConfirm("再商談", "再商談日調整中"),
    ).toBe(false);
  });

  it("アラートから消える値へ変更するときは出す", () => {
    expect(needsMeetingScheduleNegotiationConfirm("商談待ち", "否")).toBe(true);
    expect(needsMeetingScheduleNegotiationConfirm("商談待ち", "即決成約")).toBe(
      true,
    );
    expect(needsMeetingScheduleNegotiationConfirm("商談待ち", "アポキャン")).toBe(
      true,
    );
    expect(needsMeetingScheduleNegotiationConfirm("商談待ち", "返待ち")).toBe(
      true,
    );
    expect(needsMeetingScheduleNegotiationConfirm("再商談", "再商談成約")).toBe(
      true,
    );
  });

  it("空欄では出さない", () => {
    expect(needsMeetingScheduleNegotiationConfirm("商談待ち", "")).toBe(false);
  });

  /**
   * 二重管理の防止。
   * 判定を書き写すのではなく filterPendingMeetingAlerts と同じ関数を
   * 参照しているので、@pocket の全14件で両者が一致するはず。
   * ずれたらどちらかを直したときにここが落ちる
   */
  it("★ アラートの実際の判定と一致する（実際に遷移しうる全組み合わせ）", () => {
    for (const current of MEETING_SCHEDULE_NEGOTIATION_STATUSES) {
      for (const next of meetingScheduleNegotiationOptionsFor(current)) {
        const staysInAlert = filterPendingMeetingAlerts([item(next)]).length > 0;
        expect(keepsMeetingScheduleAlert(next)).toBe(staysInAlert);
        expect(needsMeetingScheduleNegotiationConfirm(current, next)).toBe(
          next !== current && !staysInAlert,
        );
      }
    }
  });
});

describe("確認ダイアログの本文", () => {
  it("変更後の値とアラートから消える旨を書く", () => {
    const msg = meetingScheduleNegotiationConfirmMessage("否");
    expect(msg).toContain("商談ステータスを「否」に変更します");
    expect(msg).toContain("出勤後の入力アラートに表示されなくなります");
  });

  it("「元に戻せません」とは書かない", () => {
    for (const s of MEETING_SCHEDULE_NEGOTIATION_STATUSES) {
      expect(meetingScheduleNegotiationConfirmMessage(s)).not.toContain(
        "元に戻せません",
      );
    }
  });
});
