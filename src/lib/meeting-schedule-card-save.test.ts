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
    negotiationStatus: "商談待ち",
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
      // 変更していなくても現在値を載せる（サーバ側が現在値なら書かない）
      negotiationStatus: "商談待ち",
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

  it("statusDetailsEditable を省略したら statusEditable に従う", () => {
    const server = values({
      estimateStatus: "商談セット作成済み",
      meetingDate: "2026-09-10",
      closeType: "両クロ",
      meetingPlace: "自宅",
    });
    const plan = planMeetingScheduleCardSave(
      server,
      { ...server, meetingPlace: "店舗" },
      { statusEditable: false, scheduleEditable: false },
    );
    expect(plan.dirty).toBe(false);
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

/**
 * 見積ステータス・日時を編集不可にしたときの回帰防止。
 * 「他の編集項目が保存できなくなる」「保存ボタンが押せなくなる」が
 * 最優先の回帰ポイント。
 */
describe("見積ステータス・日時が編集不可のとき", () => {
  /** 画面の実際の呼び出しと同じ組み合わせ */
  const LOCKED = {
    statusEditable: false,
    statusDetailsEditable: true,
    scheduleEditable: false,
  };

  const setCreated = values({
    estimateStatus: "商談セット作成済み",
    meetingDate: "2026-09-10",
    closeType: "両クロ",
    meetingPlace: "自宅",
  });

  it("【回帰防止】商談場所だけ直しても保存が通る", () => {
    const plan = planMeetingScheduleCardSave(
      setCreated,
      { ...setCreated, meetingPlace: "店舗" },
      LOCKED,
    );
    expect(plan.dirty).toBe(true);
    expect(plan.blockedReason).toBe("");
    expect(plan.patch.status).toEqual({
      status: "商談セット作成済み",
      meetingDate: "2026-09-10",
      closeType: "両クロ",
      meetingPlace: "店舗",
      negotiationStatus: "商談待ち",
    });
  });

  it("【回帰防止】初回商談実施日・片クロor両クロだけ直しても保存が通る", () => {
    const plan = planMeetingScheduleCardSave(
      setCreated,
      { ...setCreated, meetingDate: "2026-09-11", closeType: "片クロ" },
      LOCKED,
    );
    expect(plan.blockedReason).toBe("");
    expect(plan.patch.status?.meetingDate).toBe("2026-09-11");
    expect(plan.patch.status?.closeType).toBe("片クロ");
  });

  it("【回帰防止】返待ち回答日だけ直しても保存が通る", () => {
    const henmachi = values({
      estimateStatus: "返待ち",
      responseDate: "2026-09-12",
    });
    const plan = planMeetingScheduleCardSave(
      henmachi,
      { ...henmachi, responseDate: "2026-09-20" },
      LOCKED,
    );
    expect(plan.blockedReason).toBe("");
    expect(plan.patch.status).toEqual({
      status: "返待ち",
      responseDate: "2026-09-20",
    });
  });

  it("見積ステータスが空でも「選ぶと保存できます」でブロックしない", () => {
    // 選択欄が無い以上、選び直してブロックを解除することができないため、
    // このガードは絶対に立ってはいけない。
    // （現状 statusDirty が立つには非空のステータスが要るので構造上到達しないが、
    //   将来の変更で到達可能になったときの歯止めとして残す）
    const blank = values({
      estimateStatus: "",
      meetingDate: "2026-09-10",
      closeType: "両クロ",
      meetingPlace: "自宅",
    });
    const plan = planMeetingScheduleCardSave(
      blank,
      { ...blank, meetingPlace: "店舗" },
      LOCKED,
    );
    expect(plan.blockedReason).not.toBe("見積ステータスを選ぶと保存できます");
  });

  it("付随項目の必須チェックは従来どおり効く", () => {
    const plan = planMeetingScheduleCardSave(
      setCreated,
      { ...setCreated, meetingPlace: "" },
      LOCKED,
    );
    expect(plan.dirty).toBe(true);
    expect(plan.blockedReason).toBe("商談場所を選ぶと保存できます");
    expect(plan.patch).toEqual({});
  });

  it("見積ステータスを書き換えようとしても送らない", () => {
    const plan = planMeetingScheduleCardSave(
      values(),
      values({ estimateStatus: "即決成約" }),
      LOCKED,
    );
    expect(plan.statusDirty).toBe(false);
    expect(plan.dirty).toBe(false);
    expect(plan.patch).toEqual({});
  });

  it("日時を書き換えようとしても送らない", () => {
    const plan = planMeetingScheduleCardSave(
      values(),
      values({ scheduledYmd: "2026-09-30", scheduledTime: "14:30" }),
      LOCKED,
    );
    expect(plan.scheduleDirty).toBe(false);
    expect(plan.dirty).toBe(false);
    expect(plan.patch.schedule).toBeUndefined();
  });
});

/** 商談ステータスは「商談セット作成済みの入力項目」の一部として保存する */
describe("商談ステータスの保存", () => {
  const LOCKED = {
    statusEditable: false,
    statusDetailsEditable: true,
    scheduleEditable: false,
  };

  const setCreated = values({
    estimateStatus: "商談セット作成済み",
    meetingDate: "2026-09-10",
    closeType: "両クロ",
    meetingPlace: "自宅",
    negotiationStatus: "商談待ち",
  });

  it("★ 商談ステータスだけ変えても保存が通る", () => {
    const plan = planMeetingScheduleCardSave(
      setCreated,
      { ...setCreated, negotiationStatus: "否" },
      LOCKED,
    );
    expect(plan.dirty).toBe(true);
    expect(plan.blockedReason).toBe("");
    expect(plan.patch.status?.negotiationStatus).toBe("否");
  });

  it("他の付随項目と同時に変えても1回の status に載る", () => {
    const plan = planMeetingScheduleCardSave(
      setCreated,
      { ...setCreated, negotiationStatus: "再商談", meetingPlace: "店舗" },
      LOCKED,
    );
    expect(plan.patch.status).toEqual({
      status: "商談セット作成済み",
      meetingDate: "2026-09-10",
      closeType: "両クロ",
      meetingPlace: "店舗",
      negotiationStatus: "再商談",
    });
  });

  it("変えなければ dirty にならない", () => {
    const plan = planMeetingScheduleCardSave(setCreated, { ...setCreated }, LOCKED);
    expect(plan.dirty).toBe(false);
    expect(plan.patch).toEqual({});
  });

  it("変更不可の現在値でも、変えなければ何も送らない", () => {
    // 画面は選択欄を出さないので現在値のまま。dirty にならない
    const terminal = { ...setCreated, negotiationStatus: "資料送付成約" };
    const plan = planMeetingScheduleCardSave(terminal, { ...terminal }, LOCKED);
    expect(plan.dirty).toBe(false);
  });

  it("遷移表に無い現在値・空欄でも、変えなければ何も送らない", () => {
    for (const current of ["@pocket で増えた未知のステータス", ""]) {
      const outside = { ...setCreated, negotiationStatus: current };
      const plan = planMeetingScheduleCardSave(outside, { ...outside }, LOCKED);
      expect(plan.dirty, current).toBe(false);
    }
  });

  it("変更不可の現在値でも、付随項目だけの変更は保存できる", () => {
    const terminal = { ...setCreated, negotiationStatus: "否" };
    const plan = planMeetingScheduleCardSave(
      terminal,
      { ...terminal, meetingPlace: "店舗" },
      LOCKED,
    );
    expect(plan.dirty).toBe(true);
    expect(plan.blockedReason).toBe("");
    expect(plan.patch.status?.meetingPlace).toBe("店舗");
    // 現在値のまま載る。サーバ側は現在値と同じなら書き込まない
    expect(plan.patch.status?.negotiationStatus).toBe("否");
  });

  it("遷移表に従った変更は保存対象になる（返待ち → 再商談）", () => {
    const henmachi = { ...setCreated, negotiationStatus: "返待ち" };
    const plan = planMeetingScheduleCardSave(
      henmachi,
      { ...henmachi, negotiationStatus: "再商談" },
      LOCKED,
    );
    expect(plan.blockedReason).toBe("");
    expect(plan.patch.status?.negotiationStatus).toBe("再商談");
  });

  it("商談セット作成済み以外では送らない（枠の外なので編集 UI が無い）", () => {
    const henmachi = values({
      estimateStatus: "返待ち",
      responseDate: "2026-09-12",
      negotiationStatus: "商談待ち",
    });
    const plan = planMeetingScheduleCardSave(
      henmachi,
      { ...henmachi, negotiationStatus: "否" },
      LOCKED,
    );
    expect(plan.dirty).toBe(false);
  });
});
