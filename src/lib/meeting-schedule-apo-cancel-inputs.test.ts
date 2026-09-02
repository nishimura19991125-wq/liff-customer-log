import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  MEETING_SCHEDULE_NEGOTIATION_STATUSES,
  MEETING_SCHEDULE_NEGOTIATION_STATUS_SPECS,
  meetingScheduleNegotiationOptionsFor,
  needsMeetingScheduleNegotiationConfirm,
  requiresMeetingScheduleMeetingInput,
  requiresMeetingScheduleResponseDate,
  showsMeetingScheduleHenmachiForm,
  showsMeetingScheduleInputFields,
} from "@/lib/meeting-schedule-negotiation-status";
import {
  planMeetingScheduleCardSave,
  type MeetingScheduleCardValues,
} from "@/lib/meeting-schedule-card-save";

/**
 * 商談ステータスが「アポキャン」のとき、付随項目4つを出さない。
 * 商談自体がキャンセルされた状態なので入力する意味がない。
 *
 * 表示を止めるだけで @pocket の値は消さない（送らない＝消す、ではない。
 * サーバ側は空の項目を書き込み対象から外す）。
 */

/** 変更不可9件のうち、アポキャン以外の8件。従来どおり表示する */
const KEEPS_SHOWING = [
  "即決成約",
  "再商談成約",
  "返待ち成約",
  "否",
  "再商談否",
  "返待ち否",
  "資料送付成約",
  "資料送付否",
] as const;

function values(
  o: Partial<MeetingScheduleCardValues> = {},
): MeetingScheduleCardValues {
  return {
    estimateStatus: "商談セット作成済み",
    scheduledYmd: "2026-06-12",
    scheduledTime: "13:30",
    meetingDate: "",
    closeType: "",
    meetingPlace: "",
    responseDate: "",
    negotiationStatus: "商談待ち",
    ...o,
  };
}

/** 見積ステータスと日時は編集不可のまま、付随項目だけ編集できる状態 */
const detailsOnly = {
  statusEditable: false,
  statusDetailsEditable: true,
  scheduleEditable: false,
};

describe("アポキャン：付随項目を出すかどうかの判定", () => {
  it("アポキャンだけ false", () => {
    expect(showsMeetingScheduleInputFields("アポキャン")).toBe(false);
  });

  it("変更不可の他8件は従来どおり表示する", () => {
    for (const status of KEEPS_SHOWING) {
      expect(showsMeetingScheduleInputFields(status)).toBe(true);
    }
  });

  it("遷移できる5件も従来どおり表示する", () => {
    for (const status of [
      "商談待ち",
      "再商談",
      "返待ち",
      "資料送付回答待ち",
      "再商談日調整中",
    ]) {
      expect(showsMeetingScheduleInputFields(status)).toBe(true);
    }
  });

  it("14件のうち出さないのはアポキャン1件だけ", () => {
    const hidden = MEETING_SCHEDULE_NEGOTIATION_STATUSES.filter(
      (s) => !showsMeetingScheduleInputFields(s),
    );
    expect(hidden).toEqual(["アポキャン"]);
  });

  it("遷移表に無い値・空欄は出す（既定は従来どおりの表示）", () => {
    expect(showsMeetingScheduleInputFields("")).toBe(true);
    expect(showsMeetingScheduleInputFields("   ")).toBe(true);
    expect(showsMeetingScheduleInputFields("@pocket で増えた新しい値")).toBe(
      true,
    );
  });

  it("前後の空白がゆれても同じ判定になる", () => {
    expect(showsMeetingScheduleInputFields("  アポキャン  ")).toBe(false);
  });
});

describe("アポキャン：返待ち回答日", () => {
  it("見積ステータスが返待ちでも出さない", () => {
    expect(
      showsMeetingScheduleHenmachiForm({
        estimateStatusIsHenmachi: true,
        negotiationStatus: "アポキャン",
      }),
    ).toBe(false);
  });

  it("アポキャン以外では従来どおり出る", () => {
    expect(
      showsMeetingScheduleHenmachiForm({
        estimateStatusIsHenmachi: true,
        negotiationStatus: "商談待ち",
      }),
    ).toBe(true);
    expect(
      showsMeetingScheduleHenmachiForm({
        estimateStatusIsHenmachi: false,
        negotiationStatus: "返待ち",
      }),
    ).toBe(true);
  });
});

describe("アポキャン：必須判定は発火しない", () => {
  it("3項目も返待ち回答日も必須にならない", () => {
    expect(requiresMeetingScheduleMeetingInput("アポキャン")).toBe(false);
    expect(requiresMeetingScheduleResponseDate("アポキャン")).toBe(false);
  });

  it("非表示なのに必須、という組み合わせが1件も無い", () => {
    for (const status of MEETING_SCHEDULE_NEGOTIATION_STATUSES) {
      if (showsMeetingScheduleInputFields(status)) continue;
      expect(requiresMeetingScheduleMeetingInput(status)).toBe(false);
      expect(requiresMeetingScheduleResponseDate(status)).toBe(false);
    }
  });

  it("3項目が空のままでもアポキャンへ変更できる（保存が止まらない）", () => {
    const plan = planMeetingScheduleCardSave(
      values({ negotiationStatus: "商談待ち" }),
      values({ negotiationStatus: "アポキャン" }),
      detailsOnly,
    );
    expect(plan.blockedReason).toBe("");
    expect(plan.dirty).toBe(true);
  });
});

describe("アポキャン：保存で送る中身", () => {
  it("商談待ち → アポキャン は保存できる", () => {
    const plan = planMeetingScheduleCardSave(
      values({ negotiationStatus: "商談待ち" }),
      values({ negotiationStatus: "アポキャン" }),
      detailsOnly,
    );
    expect(plan.statusDirty).toBe(true);
    expect(plan.patch.status?.negotiationStatus).toBe("アポキャン");
  });

  it("画面から消えた3項目は送らない", () => {
    const plan = planMeetingScheduleCardSave(
      values({ negotiationStatus: "商談待ち" }),
      values({
        negotiationStatus: "アポキャン",
        // アポキャンに変える前に入力していた値。画面からは消えている
        meetingDate: "2026-06-20",
        closeType: "両クロ",
        meetingPlace: "自宅",
      }),
      detailsOnly,
    );
    expect(plan.patch.status?.meetingDate).toBeUndefined();
    expect(plan.patch.status?.closeType).toBeUndefined();
    expect(plan.patch.status?.meetingPlace).toBeUndefined();
    // 商談ステータスは送る
    expect(plan.patch.status?.negotiationStatus).toBe("アポキャン");
  });

  it("値が入っているアポキャンの案件は、3項目を触っても保存対象にならない", () => {
    const plan = planMeetingScheduleCardSave(
      values({
        negotiationStatus: "アポキャン",
        meetingDate: "2026-05-01",
        closeType: "片クロ",
        meetingPlace: "店舗",
      }),
      values({
        negotiationStatus: "アポキャン",
        meetingDate: "2026-06-20",
        closeType: "両クロ",
        meetingPlace: "自宅",
      }),
      detailsOnly,
    );
    expect(plan.dirty).toBe(false);
    expect(plan.patch.status).toBeUndefined();
  });

  it("アポキャンでは返待ち回答日も送らない（見積ステータスが返待ちでも）", () => {
    const plan = planMeetingScheduleCardSave(
      values({
        estimateStatus: "返待ち",
        negotiationStatus: "商談待ち",
        responseDate: "",
      }),
      values({
        estimateStatus: "返待ち",
        negotiationStatus: "アポキャン",
        responseDate: "2026-07-01",
      }),
      detailsOnly,
    );
    expect(plan.patch.status?.responseDate).toBeUndefined();
  });

  it("アポキャン以外では3項目を従来どおり送る", () => {
    for (const status of ["商談待ち", "再商談", "資料送付回答待ち"]) {
      const plan = planMeetingScheduleCardSave(
        values({ negotiationStatus: "商談待ち" }),
        values({
          negotiationStatus: status,
          meetingDate: "2026-06-20",
          closeType: "両クロ",
          meetingPlace: "自宅",
        }),
        detailsOnly,
      );
      expect(plan.patch.status?.meetingDate).toBe("2026-06-20");
      expect(plan.patch.status?.closeType).toBe("両クロ");
      expect(plan.patch.status?.meetingPlace).toBe("自宅");
    }
  });
});

describe("回帰：遷移ルールと確認ダイアログは変えていない", () => {
  it("遷移先は従来どおり", () => {
    expect(meetingScheduleNegotiationOptionsFor("商談待ち")).toEqual([
      "商談待ち",
      "即決成約",
      "再商談",
      "返待ち",
      "否",
      "アポキャン",
    ]);
    expect(meetingScheduleNegotiationOptionsFor("アポキャン")).toEqual([]);
  });

  it("必須の要否は14件とも従来どおり", () => {
    const required = MEETING_SCHEDULE_NEGOTIATION_STATUSES.filter(
      (s) => MEETING_SCHEDULE_NEGOTIATION_STATUS_SPECS[s].requiresMeetingInput,
    );
    expect(required).toEqual([
      "再商談",
      "返待ち",
      "再商談日調整中",
      "即決成約",
      "再商談成約",
      "返待ち成約",
      "否",
      "再商談否",
      "返待ち否",
    ]);
  });

  it("確認ダイアログを出す条件は従来どおり", () => {
    expect(
      needsMeetingScheduleNegotiationConfirm("商談待ち", "アポキャン"),
    ).toBe(true);
    expect(needsMeetingScheduleNegotiationConfirm("商談待ち", "再商談")).toBe(
      false,
    );
    expect(
      needsMeetingScheduleNegotiationConfirm("アポキャン", "アポキャン"),
    ).toBe(false);
  });
});

describe("2画面で同じ挙動になる（配線）", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  const fields = read("src/components/meeting-schedule-status-fields.tsx");
  const hook = read("src/hooks/use-meeting-schedule-status-form.ts");
  const card = read("src/components/meeting-schedule-item-card.tsx");
  const editor = read("src/components/apo-list-status-editor.tsx");

  it("判定はフックが持ち、入力欄の部品は受け取るだけ", () => {
    expect(hook).toContain("showsMeetingScheduleInputFields(negotiationStatus)");
    expect(fields).not.toContain("showsMeetingScheduleInputFields");
    // コメントで触れるのは可。ステータス名で分岐していないことを見る
    expect(fields).not.toContain('"アポキャン"');
  });

  it("商談予定とアポ情報一覧の両方が showMeetingInputs を渡す", () => {
    for (const src of [card, editor]) {
      expect(src).toContain("showMeetingInputs,");
      expect(src).toContain("showMeetingInputs={showMeetingInputs}");
    }
  });

  it("商談ステータスの行は消さない（3項目だけを囲む）", () => {
    const gateAt = fields.indexOf("{showMeetingInputs ? (");
    const statusRowAt = fields.indexOf("この商談ステータスからは変更できません");
    expect(gateAt).toBeGreaterThan(-1);
    // 商談ステータスの行は囲みより前にある＝囲みの外
    expect(statusRowAt).toBeLessThan(gateAt);
  });
});
