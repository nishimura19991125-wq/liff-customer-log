import { describe, expect, it } from "vitest";

import {
  buildMeetingScheduleSaveConfirm,
  canEditMeetingScheduleNegotiationStatus,
  filterOpenMeetingScheduleItems,
  isMeetingScheduleNegotiationOpen,
  findMissingMeetingScheduleRequiredInput,
  isMeetingScheduleInputLocked,
  isMeetingScheduleInputNewlyEntered,
  requiresMeetingScheduleMeetingInput,
  requiresMeetingScheduleResponseDate,
  showsMeetingScheduleHenmachiForm,
  MEETING_SCHEDULE_INPUT_FIELDS_BY_FORM,
  MEETING_SCHEDULE_INPUT_FIELD_LABELS,
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
    // アラートの日付条件は満たしておく（下の一致テストで
    // 商談ステータスの判定だけを見たいため）
    scheduledDateTimeYmd: "2026-06-12",
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
        // 日付条件は満たした状態で、商談ステータスの判定だけを突き合わせる
        const staysInAlert =
          filterPendingMeetingAlerts([item(next)], "2026-08-26").length > 0;
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

describe("必須の要否（商談ステータス基準）", () => {
  /** 仕様: この5件では3項目を必須にしない */
  const NOT_REQUIRED = [
    "商談待ち",
    "資料送付回答待ち",
    "資料送付成約",
    "資料送付否",
    "アポキャン",
  ];

  it("★ 5件では必須にしない", () => {
    for (const s of NOT_REQUIRED) {
      expect(requiresMeetingScheduleMeetingInput(s), s).toBe(false);
    }
  });

  it("★ 残り9件では必須にする", () => {
    const required = MEETING_SCHEDULE_NEGOTIATION_STATUSES.filter(
      (s) => !NOT_REQUIRED.includes(s),
    );
    expect(required).toHaveLength(9);
    for (const s of required) {
      expect(requiresMeetingScheduleMeetingInput(s), s).toBe(true);
    }
  });

  it("★ 返待ち回答日が必須なのは「返待ち」のときだけ", () => {
    for (const s of MEETING_SCHEDULE_NEGOTIATION_STATUSES) {
      expect(requiresMeetingScheduleResponseDate(s), s).toBe(s === "返待ち");
    }
  });

  it("14件の外・空欄では必須にしない（既存案件を編集不能にしない）", () => {
    for (const s of ["", "   ", "未知のステータス"]) {
      expect(requiresMeetingScheduleMeetingInput(s)).toBe(false);
      expect(requiresMeetingScheduleResponseDate(s)).toBe(false);
    }
  });
});

describe("入力済みなら変更不可", () => {
  it("★ 項目ごとに個別に判定する", () => {
    expect(isMeetingScheduleInputLocked("2026-09-10")).toBe(true);
    expect(isMeetingScheduleInputLocked("自宅")).toBe(true);
    expect(isMeetingScheduleInputLocked("")).toBe(false);
    expect(isMeetingScheduleInputLocked("   ")).toBe(false);
  });

  it("空だった項目に値を入れるときだけ「新規入力」とみなす", () => {
    expect(isMeetingScheduleInputNewlyEntered("", "自宅")).toBe(true);
    expect(isMeetingScheduleInputNewlyEntered("", "")).toBe(false);
    // 入力済みの項目は画面に入力欄が出ないので、ここは通常起きない
    expect(isMeetingScheduleInputNewlyEntered("自宅", "店舗")).toBe(false);
  });
});

describe("必須の検証範囲（触っていない空欄では止めない）", () => {
  const blank = {
    meetingDate: "",
    closeType: "",
    meetingPlace: "",
    responseDate: "",
  };

  it("★★ 触っていない空欄では止めない（既存の空データを編集不能にしない）", () => {
    expect(
      findMissingMeetingScheduleRequiredInput({
        server: blank,
        draft: blank,
        serverNegotiationStatus: "再商談",
        draftNegotiationStatus: "再商談",
      }),
    ).toBeNull();
  });

  it("1つ入力すると、他の必須項目も求められる", () => {
    expect(
      findMissingMeetingScheduleRequiredInput({
        server: blank,
        draft: { ...blank, meetingPlace: "自宅" },
        serverNegotiationStatus: "再商談",
        draftNegotiationStatus: "再商談",
      }),
    ).toBe("meetingDate");
  });

  it("既存値があれば埋まっているとみなす", () => {
    expect(
      findMissingMeetingScheduleRequiredInput({
        server: { ...blank, meetingDate: "2026-09-10", closeType: "両クロ" },
        draft: {
          ...blank,
          meetingDate: "2026-09-10",
          closeType: "両クロ",
          meetingPlace: "自宅",
        },
        serverNegotiationStatus: "再商談",
        draftNegotiationStatus: "再商談",
      }),
    ).toBeNull();
  });

  it("必須にしない5件なら、1つ入力しても他を求めない", () => {
    expect(
      findMissingMeetingScheduleRequiredInput({
        server: blank,
        draft: { ...blank, meetingPlace: "自宅" },
        serverNegotiationStatus: "商談待ち",
        draftNegotiationStatus: "商談待ち",
      }),
    ).toBeNull();
  });

  it("商談ステータスを必須の値へ変えると、3項目を求める", () => {
    expect(
      findMissingMeetingScheduleRequiredInput({
        server: blank,
        draft: blank,
        serverNegotiationStatus: "商談待ち",
        draftNegotiationStatus: "再商談",
      }),
    ).toBe("meetingDate");
  });

  it("★ 商談ステータスを返待ちへ変えると、返待ち回答日も求める", () => {
    const filled = {
      meetingDate: "2026-09-10",
      closeType: "両クロ",
      meetingPlace: "自宅",
      responseDate: "",
    };
    expect(
      findMissingMeetingScheduleRequiredInput({
        server: filled,
        draft: filled,
        serverNegotiationStatus: "商談待ち",
        draftNegotiationStatus: "返待ち",
      }),
    ).toBe("responseDate");
  });
});

describe("入力枠の表示", () => {
  it("★ 返待ち回答日の枠は、見積ステータスか商談ステータスが返待ちなら出す", () => {
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
    expect(
      showsMeetingScheduleHenmachiForm({
        estimateStatusIsHenmachi: false,
        negotiationStatus: "商談待ち",
      }),
    ).toBe(false);
  });

  /**
   * ★「必須ならば必ず入力できる」の構造保証。
   * 必須になる条件が表示条件の部分集合であることを全14件で確認する
   */
  it("★★ 返待ち回答日が必須なら、必ず入力枠が出る", () => {
    for (const s of MEETING_SCHEDULE_NEGOTIATION_STATUSES) {
      if (!requiresMeetingScheduleResponseDate(s)) continue;
      expect(
        showsMeetingScheduleHenmachiForm({
          estimateStatusIsHenmachi: false,
          negotiationStatus: s,
        }),
        s,
      ).toBe(true);
    }
  });

  it("★ 同じ項目が2つの枠に現れない（二重描画の防止）", () => {
    const setCreated = MEETING_SCHEDULE_INPUT_FIELDS_BY_FORM.setCreated;
    const henmachi = MEETING_SCHEDULE_INPUT_FIELDS_BY_FORM.henmachi;
    for (const key of setCreated) {
      expect(henmachi).not.toContain(key);
    }
    expect([...setCreated, ...henmachi].sort()).toEqual(
      Object.keys(MEETING_SCHEDULE_INPUT_FIELD_LABELS).sort(),
    );
  });
});

describe("確認ダイアログの組み立て", () => {
  it("★ 新たに入力される項目だけを並べる", () => {
    const c = buildMeetingScheduleSaveConfirm({
      serverNegotiationStatus: "商談待ち",
      draftNegotiationStatus: "商談待ち",
      newlyEntered: [
        { label: "初回商談実施日", value: "2026/06/12" },
        { label: "商談場所", value: "宅内テーブル商談" },
      ],
    });
    expect(c.needed).toBe(true);
    expect(c.title).toBe("入力内容の確定");
    expect(c.blocks).toHaveLength(1);
    expect(c.blocks[0]).toBe(
      [
        "以下の項目を保存します。保存後は変更できません。",
        "・初回商談実施日: 2026/06/12",
        "・商談場所: 宅内テーブル商談",
      ].join("\n"),
    );
    expect(c.blocks[0]).not.toContain("片クロor両クロ");
    expect(c.blocks[0]).not.toContain("返待ち回答日");
  });

  it("★ 商談ステータスの確認と同時でも、ダイアログは1つにまとまる", () => {
    const c = buildMeetingScheduleSaveConfirm({
      serverNegotiationStatus: "商談待ち",
      draftNegotiationStatus: "否",
      newlyEntered: [{ label: "商談場所", value: "宅内テーブル商談" }],
    });
    expect(c.needed).toBe(true);
    expect(c.title).toBe("商談ステータスの変更と入力の確定");
    expect(c.blocks).toHaveLength(2);
    expect(c.blocks[0]).toContain("商談ステータスを「否」に変更します");
    expect(c.blocks[1]).toContain("保存後は変更できません");
  });

  it("商談ステータスの変更だけなら、その1ブロックだけ", () => {
    const c = buildMeetingScheduleSaveConfirm({
      serverNegotiationStatus: "商談待ち",
      draftNegotiationStatus: "否",
      newlyEntered: [],
    });
    expect(c.title).toBe("商談ステータスの変更");
    expect(c.blocks).toHaveLength(1);
  });

  it("どちらも無ければ確認しない", () => {
    const c = buildMeetingScheduleSaveConfirm({
      serverNegotiationStatus: "商談待ち",
      draftNegotiationStatus: "商談待ち",
      newlyEntered: [],
    });
    expect(c.needed).toBe(false);
    expect(c.blocks).toEqual([]);
  });

  it("アラートに残る値への変更＋新規入力なら、入力の確定だけ出す", () => {
    const c = buildMeetingScheduleSaveConfirm({
      serverNegotiationStatus: "商談待ち",
      draftNegotiationStatus: "再商談",
      newlyEntered: [{ label: "商談場所", value: "宅内テーブル商談" }],
    });
    expect(c.title).toBe("入力内容の確定");
    expect(c.blocks).toHaveLength(1);
  });
});

/**
 * 商談が進行中の案件だけを出す絞り込み。
 * ホーム画面「商談進捗」パネルと /meeting-schedule の「一覧」タブが
 * 同じこの判定を参照する（二重管理にしない）
 */
describe("進行中の案件の絞り込み", () => {
  /** 仕様: この5件だけ表示する */
  const SHOWN = [
    "商談待ち",
    "返待ち",
    "資料送付回答待ち",
    "再商談",
    "再商談日調整中",
  ];

  it("★ 5件の案件は表示する", () => {
    for (const s of SHOWN) {
      expect(isMeetingScheduleNegotiationOpen(s), s).toBe(true);
    }
  });

  it("★ 残り9件（結果が確定済み）は表示しない", () => {
    const hidden = MEETING_SCHEDULE_NEGOTIATION_STATUSES.filter(
      (s) => !SHOWN.includes(s),
    );
    expect(hidden).toHaveLength(9);
    expect(hidden).toContain("即決成約");
    expect(hidden).toContain("否");
    expect(hidden).toContain("アポキャン");
    for (const s of hidden) {
      expect(isMeetingScheduleNegotiationOpen(s), s).toBe(false);
    }
  });

  it("★ 遷移表で「遷移先が空でない5件」と一致する（リストを二重に持たない）", () => {
    for (const s of MEETING_SCHEDULE_NEGOTIATION_STATUSES) {
      expect(isMeetingScheduleNegotiationOpen(s), s).toBe(
        canEditMeetingScheduleNegotiationStatus(s),
      );
    }
  });

  it("★ 商談ステータスが空欄・遷移表の外なら表示しない（見積ステータス側とは逆）", () => {
    for (const s of ["", "   ", "未知のステータス"]) {
      expect(isMeetingScheduleNegotiationOpen(s)).toBe(false);
    }
  });

  it("★ 件数は絞り込み後の件数になる", () => {
    const items = [
      { recordId: "1", negotiationStatus: "商談待ち" },
      { recordId: "2", negotiationStatus: "即決成約" },
      { recordId: "3", negotiationStatus: "返待ち" },
      { recordId: "4", negotiationStatus: "アポキャン" },
      { recordId: "5", negotiationStatus: "" },
      { recordId: "6", negotiationStatus: "再商談日調整中" },
    ];

    const filtered = filterOpenMeetingScheduleItems(items);
    expect(filtered).toHaveLength(3);
    expect(filtered.map((i) => i.recordId)).toEqual(["1", "3", "6"]);
  });

  it("0件でも壊れない", () => {
    expect(filterOpenMeetingScheduleItems([])).toEqual([]);
    expect(
      filterOpenMeetingScheduleItems([
        { negotiationStatus: "即決成約" },
      ]),
    ).toEqual([]);
  });

  /**
   * 意図した仕様。パネル（5件）とアラート（3件）で条件が違う。
   * アラート側のラベルが waiting / re-negotiation の2値しかなく、
   * 5件に広げると返待ち・資料送付回答待ちが「再商談」と誤表示されるため
   */
  it("★ 出勤後アラートの条件（3件）とは一致しない（意図した差）", () => {
    const alertOnly = MEETING_SCHEDULE_NEGOTIATION_STATUSES.filter((s) =>
      keepsMeetingScheduleAlert(s),
    );
    expect(alertOnly).toEqual(["商談待ち", "再商談", "再商談日調整中"]);

    // パネルはアラートより広い（返待ち・資料送付回答待ちが増える）
    for (const s of alertOnly) {
      expect(isMeetingScheduleNegotiationOpen(s), s).toBe(true);
    }
    expect(keepsMeetingScheduleAlert("返待ち")).toBe(false);
    expect(isMeetingScheduleNegotiationOpen("返待ち")).toBe(true);
    expect(keepsMeetingScheduleAlert("資料送付回答待ち")).toBe(false);
    expect(isMeetingScheduleNegotiationOpen("資料送付回答待ち")).toBe(true);
  });
});
