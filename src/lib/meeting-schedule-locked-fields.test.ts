import { describe, expect, it } from "vitest";

import {
  isMeetingScheduleFieldLocked,
  resolveMeetingScheduleCardEditability,
  stripLockedMeetingScheduleFieldsFromPayload,
} from "@/lib/meeting-schedule-locked-fields";

const ALL_ENABLED = {
  statusEditable: true,
  scheduleEditable: true,
  savable: true,
  hasStatusOptions: true,
};

describe("編集不可な項目の定義", () => {
  it("見積ステータスと商談・資料送付予定日時が編集不可", () => {
    expect(isMeetingScheduleFieldLocked("estimateStatus")).toBe(true);
    expect(isMeetingScheduleFieldLocked("scheduledDateTime")).toBe(true);
  });
});

describe("stripLockedMeetingScheduleFieldsFromPayload", () => {
  it("見積ステータスの列を payload から落とす", () => {
    const payload: Record<string, unknown> = {
      key1: "アポ通番",
      f_status: "商談セット作成済み",
      f_place: "自宅",
    };

    const dropped = stripLockedMeetingScheduleFieldsFromPayload(payload, {
      estimateStatus: "f_status",
    });

    expect(dropped).toEqual(["estimateStatus"]);
    expect(payload).toEqual({ key1: "アポ通番", f_place: "自宅" });
  });

  it("付随項目は落とさない（他項目の保存を巻き込まない）", () => {
    const payload: Record<string, unknown> = {
      key1: "アポ通番",
      f_status: "商談セット作成済み",
      f_meeting_date: "2026-09-10",
      f_close_type: "両クロ",
      f_place: "自宅",
      f_response_date: "2026-09-12",
    };

    stripLockedMeetingScheduleFieldsFromPayload(payload, {
      estimateStatus: "f_status",
    });

    expect(payload).toEqual({
      key1: "アポ通番",
      f_meeting_date: "2026-09-10",
      f_close_type: "両クロ",
      f_place: "自宅",
      f_response_date: "2026-09-12",
    });
  });

  it("日時の列も落とす", () => {
    const payload: Record<string, unknown> = {
      key1: "アポ通番",
      f_scheduled: "2026-09-05 10:00:00",
    };

    const dropped = stripLockedMeetingScheduleFieldsFromPayload(payload, {
      scheduledDateTime: "f_scheduled",
    });

    expect(dropped).toEqual(["scheduledDateTime"]);
    expect(payload).toEqual({ key1: "アポ通番" });
  });

  it("列が解決できない・payload に無いときは何もしない", () => {
    const payload: Record<string, unknown> = { key1: "アポ通番" };

    expect(
      stripLockedMeetingScheduleFieldsFromPayload(payload, {
        estimateStatus: "f_status",
      }),
    ).toEqual([]);
    expect(
      stripLockedMeetingScheduleFieldsFromPayload(payload, {
        estimateStatus: null,
      }),
    ).toEqual([]);
    expect(payload).toEqual({ key1: "アポ通番" });
  });
});

describe("resolveMeetingScheduleCardEditability", () => {
  it("見積ステータスと日時の入力欄は出さない", () => {
    const e = resolveMeetingScheduleCardEditability(ALL_ENABLED);
    expect(e.canEditStatus).toBe(false);
    expect(e.canEditSchedule).toBe(false);
  });

  it("値のテキスト表示に置き換わる", () => {
    const e = resolveMeetingScheduleCardEditability(ALL_ENABLED);
    expect(e.showStatusText).toBe(true);
    expect(e.showScheduleText).toBe(true);
  });

  it("【回帰防止】保存ボタンは消えない", () => {
    expect(resolveMeetingScheduleCardEditability(ALL_ENABLED).showSaveBar).toBe(
      true,
    );
  });

  it("【回帰防止】付随項目は引き続き編集できる", () => {
    expect(
      resolveMeetingScheduleCardEditability(ALL_ENABLED).canEditStatusDetails,
    ).toBe(true);
  });

  it("保存の口が無いときは保存ボタンもテキストも出さない", () => {
    const e = resolveMeetingScheduleCardEditability({
      ...ALL_ENABLED,
      savable: false,
    });
    expect(e.showSaveBar).toBe(false);
    expect(e.canEditStatusDetails).toBe(false);
    expect(e.showStatusText).toBe(false);
    expect(e.showScheduleText).toBe(false);
  });

  it("@pocket への書き込みが未設定なら従来どおり何も出さない", () => {
    const e = resolveMeetingScheduleCardEditability({
      statusEditable: false,
      scheduleEditable: false,
      savable: true,
      hasStatusOptions: true,
    });
    expect(e.showSaveBar).toBe(false);
    expect(e.canEditStatusDetails).toBe(false);
    expect(e.showStatusText).toBe(false);
    expect(e.showScheduleText).toBe(false);
  });
});
