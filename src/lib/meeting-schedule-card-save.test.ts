import { describe, expect, it } from "vitest";

import {
  planMeetingScheduleCardSave,
  type MeetingScheduleCardValues,
} from "@/lib/meeting-schedule-card-save";

const BOTH_EDITABLE = { statusEditable: true, scheduleEditable: true };

function values(
  over: Partial<MeetingScheduleCardValues> = {},
): MeetingScheduleCardValues {
  return {
    estimateStatus: "見積依頼済み",
    scheduledYmd: "2026-09-05",
    scheduledTime: "10:00",
    meetingDate: "",
    closeType: "",
    meetingPlace: "",
    responseDate: "",
    ...over,
  };
}

describe("planMeetingScheduleCardSave", () => {
  it("変更が無ければ何も送らない", () => {
    const server = values();
    const plan = planMeetingScheduleCardSave(server, values(), BOTH_EDITABLE);
    expect(plan.dirty).toBe(false);
    expect(plan.patch).toEqual({});
  });

  it("ステータスだけ変えたら status だけ送る", () => {
    const plan = planMeetingScheduleCardSave(
      values(),
      values({ estimateStatus: "見積提出済み" }),
      BOTH_EDITABLE,
    );
    expect(plan.statusDirty).toBe(true);
    expect(plan.scheduleDirty).toBe(false);
    expect(plan.patch).toEqual({ status: { status: "見積提出済み" } });
  });

  it("日時だけ変えたら schedule だけ送る", () => {
    const plan = planMeetingScheduleCardSave(
      values(),
      values({ scheduledTime: "14:30" }),
      BOTH_EDITABLE,
    );
    expect(plan.statusDirty).toBe(false);
    expect(plan.scheduleDirty).toBe(true);
    expect(plan.patch).toEqual({
      schedule: { scheduledYmd: "2026-09-05", scheduledTime: "14:30" },
    });
  });

  it("両方変えたら両方送る", () => {
    const plan = planMeetingScheduleCardSave(
      values(),
      values({ estimateStatus: "見積提出済み", scheduledYmd: "2026-09-06" }),
      BOTH_EDITABLE,
    );
    expect(plan.patch.status).toEqual({ status: "見積提出済み" });
    expect(plan.patch.schedule).toEqual({
      scheduledYmd: "2026-09-06",
      scheduledTime: "10:00",
    });
  });

  it("商談セット作成済みは付随3項目を同じ status に載せる", () => {
    const plan = planMeetingScheduleCardSave(
      values(),
      values({
        estimateStatus: "商談セット作成済み",
        meetingDate: "2026-09-10",
        closeType: "両クロ",
        meetingPlace: "自宅",
      }),
      BOTH_EDITABLE,
    );
    expect(plan.blockedReason).toBe("");
    expect(plan.patch.status).toEqual({
      status: "商談セット作成済み",
      meetingDate: "2026-09-10",
      closeType: "両クロ",
      meetingPlace: "自宅",
    });
  });

  it("商談セット作成済みで付随項目が欠けていたら保存させない", () => {
    const plan = planMeetingScheduleCardSave(
      values(),
      values({ estimateStatus: "商談セット作成済み" }),
      BOTH_EDITABLE,
    );
    expect(plan.dirty).toBe(true);
    expect(plan.blockedReason).toBe("初回商談実施日を入力すると保存できます");
    expect(plan.patch).toEqual({});
  });

  it("ステータスを変えずに付随項目だけ直しても保存対象になる", () => {
    const server = values({
      estimateStatus: "商談セット作成済み",
      meetingDate: "2026-09-10",
      closeType: "両クロ",
      meetingPlace: "自宅",
    });
    const plan = planMeetingScheduleCardSave(
      server,
      { ...server, meetingPlace: "店舗" },
      BOTH_EDITABLE,
    );
    expect(plan.statusDirty).toBe(true);
    expect(plan.patch.status?.meetingPlace).toBe("店舗");
  });

  it("返待ちは回答日が要る", () => {
    const draft = values({ estimateStatus: "返待ち" });
    expect(
      planMeetingScheduleCardSave(values(), draft, BOTH_EDITABLE).blockedReason,
    ).toBe("返待ち回答日を入力すると保存できます");

    const filled = planMeetingScheduleCardSave(
      values(),
      { ...draft, responseDate: "2026-09-12" },
      BOTH_EDITABLE,
    );
    expect(filled.blockedReason).toBe("");
    expect(filled.patch.status).toEqual({
      status: "返待ち",
      responseDate: "2026-09-12",
    });
  });

  it("日付を空にしたら保存させない（サーバが 400 を返す送信を止める）", () => {
    const plan = planMeetingScheduleCardSave(
      values(),
      values({ scheduledYmd: "" }),
      BOTH_EDITABLE,
    );
    expect(plan.dirty).toBe(true);
    expect(plan.blockedReason).toBe("日付を入力すると保存できます");
    expect(plan.patch).toEqual({});
  });

  it("編集不可の側は変更があっても送らない", () => {
    const draft = values({ estimateStatus: "見積提出済み", scheduledTime: "14:30" });

    const statusOnly = planMeetingScheduleCardSave(values(), draft, {
      statusEditable: true,
      scheduleEditable: false,
    });
    expect(statusOnly.scheduleDirty).toBe(false);
    expect(statusOnly.patch.schedule).toBeUndefined();

    const scheduleOnly = planMeetingScheduleCardSave(values(), draft, {
      statusEditable: false,
      scheduleEditable: true,
    });
    expect(scheduleOnly.statusDirty).toBe(false);
    expect(scheduleOnly.patch.status).toBeUndefined();
  });

  it("片方が保存済みになると、残った側だけが再送対象になる", () => {
    // status は成功、schedule は失敗した直後の再取得を想定
    const serverAfter = values({ estimateStatus: "見積提出済み" });
    const draft = values({ estimateStatus: "見積提出済み", scheduledTime: "14:30" });
    const plan = planMeetingScheduleCardSave(serverAfter, draft, BOTH_EDITABLE);
    expect(plan.statusDirty).toBe(false);
    expect(plan.patch.status).toBeUndefined();
    expect(plan.patch.schedule).toEqual({
      scheduledYmd: "2026-09-05",
      scheduledTime: "14:30",
    });
  });
});
