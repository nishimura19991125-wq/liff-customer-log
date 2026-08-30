import { describe, expect, it } from "vitest";

import {
  MOVE_SLOT_CHOICE_NEW,
  MOVE_SLOT_CHOICE_NONE,
  MOVE_SLOT_CONTRACTOR_UNSET_LABEL,
  buildMoveSlotChoices,
  canConfirmMoveCase,
  moveSlotChoiceIsNew,
  moveTargetIsSameDay,
  resolveMoveContractorInput,
  slotRecordIdFromChoice,
} from "@/lib/calendar-move-slot-choice";
import type { MoveTargetSlot } from "@/lib/calendar-move-target-slots";
import { formatDisplayYmd } from "@/lib/format-display-ymd";

/**
 * 工事日変更 M-3: 移動先の選び方（ラジオ）と、実行してよいかの判定。
 *
 * 元に戻せない操作なので、ここで固定するのは次の3つ。
 *   - 空き枠を全部並べ、日付と施工会社が2行で分かり、末尾が「新しく作成する」
 *   - 施工業者の欄は新規作成のときだけ出す
 *   - 選び終えていないものがあれば実行させない
 */

const SLOTS: MoveTargetSlot[] = [
  { recordId: "5002", contractorName: "Roof10" },
  { recordId: "5003", contractorName: "unity" },
];

describe("移動先の選択肢", () => {
  it("★ その日の空き枠を全部並べ、末尾に「新しく作成する」を置く", () => {
    const choices = buildMoveSlotChoices(SLOTS, "2026-12-05");

    expect(choices).toHaveLength(3);
    expect(choices.map((c) => c.value)).toEqual([
      "5002",
      "5003",
      MOVE_SLOT_CHOICE_NEW,
    ]);
    expect(choices[2].label).toBe("新しく作成する");
    expect(choices[2].isNew).toBe(true);
  });

  it("★ 空き枠は日付と施工会社の2行に分ける", () => {
    const choices = buildMoveSlotChoices(SLOTS, "2026-12-05");

    expect(choices[0]).toEqual({
      value: "5002",
      label: "2026/12/05",
      detail: "施工会社: Roof10",
      isNew: false,
    });
    expect(choices[1]).toEqual({
      value: "5003",
      label: "2026/12/05",
      detail: "施工会社: unity",
      isNew: false,
    });
  });

  it("★ 1行目は移動先として入力された日付（確認画面と同じ形式）", () => {
    const choices = buildMoveSlotChoices(SLOTS, "2027-01-05");

    // どの枠も同じ日付になる（その日の枠しか並ばないため）
    expect(choices[0].label).toBe("2027/01/05");
    expect(choices[1].label).toBe("2027/01/05");
    // 確認画面の文言と同じ整形を使う
    expect(choices[0].label).toBe(formatDisplayYmd("2027-01-05"));
  });

  it("★ 「新しく作成する」は1行のまま（2行目を持たない）", () => {
    const choices = buildMoveSlotChoices(SLOTS, "2026-12-05");

    expect(choices[2].detail).toBeNull();
  });

  it("★ 施工会社が入っていない枠は、移動元のまま残ることまで出す", () => {
    const choices = buildMoveSlotChoices(
      [{ recordId: "5009", contractorName: "" }],
      "2026-12-05",
    );

    expect(choices[0].label).toBe("2026/12/05");
    expect(choices[0].detail).toBe(MOVE_SLOT_CONTRACTOR_UNSET_LABEL);
    expect(MOVE_SLOT_CONTRACTOR_UNSET_LABEL).toBe("施工会社: 未設定（移動元のまま）");
  });

  it("空白だけの施工会社も「未設定」として扱う", () => {
    const choices = buildMoveSlotChoices(
      [{ recordId: "5009", contractorName: "   " }],
      "2026-12-05",
    );

    expect(choices[0].detail).toBe(MOVE_SLOT_CONTRACTOR_UNSET_LABEL);
  });

  it("★ 空き枠が無い日は「新しく作成する」だけになる", () => {
    const choices = buildMoveSlotChoices([], "2026-12-05");

    expect(choices).toHaveLength(1);
    expect(choices[0].value).toBe(MOVE_SLOT_CHOICE_NEW);
    expect(choices[0].label).toBe("新しく作成する");
    expect(choices[0].detail).toBeNull();
  });

  it("★ 読めない日付でも枠の情報は落とさない", () => {
    const choices = buildMoveSlotChoices(SLOTS, "");

    expect(choices[0].label).toBe("空き枠");
    expect(choices[0].detail).toBe("施工会社: Roof10");
  });
});

describe("選んだ値の読み替え", () => {
  it("★ 空き枠を選んだら recordId を送る", () => {
    expect(slotRecordIdFromChoice("5002")).toBe("5002");
    expect(moveSlotChoiceIsNew("5002")).toBe(false);
  });

  it("★ 新規作成では slotRecordId を送らない", () => {
    expect(slotRecordIdFromChoice(MOVE_SLOT_CHOICE_NEW)).toBe("");
    expect(moveSlotChoiceIsNew(MOVE_SLOT_CHOICE_NEW)).toBe(true);
  });

  it("★ 未選択も slotRecordId を送らない", () => {
    expect(slotRecordIdFromChoice(MOVE_SLOT_CHOICE_NONE)).toBe("");
    expect(moveSlotChoiceIsNew(MOVE_SLOT_CHOICE_NONE)).toBe(false);
  });

  it("★ 未選択と新規作成は別物（空文字が新規作成を兼ねない）", () => {
    expect(MOVE_SLOT_CHOICE_NONE).not.toBe(MOVE_SLOT_CHOICE_NEW);
    expect(MOVE_SLOT_CHOICE_NONE).toBe("");
  });
});

describe("施工業者の欄を出すか", () => {
  const READY = {
    optionsLoading: false,
    optionsConfigured: true,
    optionCount: 3,
  };

  it("★ 「新しく作成する」を選んだときだけ出す", () => {
    expect(
      resolveMoveContractorInput({ slotChoice: MOVE_SLOT_CHOICE_NEW, ...READY }),
    ).toEqual({ show: true, required: true });
  });

  it("★ 空き枠を選んだときは出さない（枠の施工会社が使われる）", () => {
    expect(
      resolveMoveContractorInput({ slotChoice: "5002", ...READY }),
    ).toEqual({ show: false, required: false });
  });

  it("★ 未選択のときも出さない", () => {
    expect(
      resolveMoveContractorInput({ slotChoice: MOVE_SLOT_CHOICE_NONE, ...READY }),
    ).toEqual({ show: false, required: false });
  });

  it("★ 一覧を読み込み中は必須のまま止める（引けないと決めつけない）", () => {
    expect(
      resolveMoveContractorInput({
        slotChoice: MOVE_SLOT_CHOICE_NEW,
        optionsLoading: true,
        optionsConfigured: false,
        optionCount: 0,
      }),
    ).toEqual({ show: true, required: true });
  });

  it("★ 環境変数が未設定なら必須にしない（新規作成での移動を止めない）", () => {
    expect(
      resolveMoveContractorInput({
        slotChoice: MOVE_SLOT_CHOICE_NEW,
        optionsLoading: false,
        optionsConfigured: false,
        optionCount: 0,
      }),
    ).toEqual({ show: true, required: false });
  });

  it("★ 一覧は引けたが候補が0件でも必須にしない", () => {
    expect(
      resolveMoveContractorInput({
        slotChoice: MOVE_SLOT_CHOICE_NEW,
        optionsLoading: false,
        optionsConfigured: true,
        optionCount: 0,
      }),
    ).toEqual({ show: true, required: false });
  });
});

describe("同じ日への移動", () => {
  it("★ 同じ日は弾く", () => {
    expect(moveTargetIsSameDay("2026-12-01", "2026-12-01")).toBe(true);
  });

  it("★ 別の日は弾かない", () => {
    expect(moveTargetIsSameDay("2026-12-05", "2026-12-01")).toBe(false);
  });

  it("★ 未選択は「同じ日」にしない", () => {
    expect(moveTargetIsSameDay("", "")).toBe(false);
  });
});

describe("実行してよいか", () => {
  const OK = {
    canOpen: true,
    targetDayKey: "2026-12-05",
    sourceDayKey: "2026-12-01",
    slotChoice: "5002",
    handlerRequired: false,
    handlerStaffId: "",
    contractorRequired: false,
    contractor: "",
  };

  it("★ 空き枠を選んだら、施工業者が未選択でも押せる", () => {
    expect(canConfirmMoveCase(OK)).toBe(true);
  });

  it("★ 枠を選んでいなければ押せない", () => {
    expect(
      canConfirmMoveCase({ ...OK, slotChoice: MOVE_SLOT_CHOICE_NONE }),
    ).toBe(false);
  });

  it("★ 新規作成で施工業者が未選択なら押せない", () => {
    expect(
      canConfirmMoveCase({
        ...OK,
        slotChoice: MOVE_SLOT_CHOICE_NEW,
        contractorRequired: true,
        contractor: "",
      }),
    ).toBe(false);
  });

  it("★ 新規作成で施工業者を選べば押せる", () => {
    expect(
      canConfirmMoveCase({
        ...OK,
        slotChoice: MOVE_SLOT_CHOICE_NEW,
        contractorRequired: true,
        contractor: "Roof10",
      }),
    ).toBe(true);
  });

  it("★ 空白だけの施工業者は選んだことにしない", () => {
    expect(
      canConfirmMoveCase({
        ...OK,
        slotChoice: MOVE_SLOT_CHOICE_NEW,
        contractorRequired: true,
        contractor: "   ",
      }),
    ).toBe(false);
  });

  it("★ 一覧を引けない環境では、施工業者が空でも新規作成で押せる", () => {
    expect(
      canConfirmMoveCase({
        ...OK,
        slotChoice: MOVE_SLOT_CHOICE_NEW,
        contractorRequired: false,
        contractor: "",
      }),
    ).toBe(true);
  });

  it("★ 日付が未選択なら押せない", () => {
    expect(canConfirmMoveCase({ ...OK, targetDayKey: "" })).toBe(false);
  });

  it("★ 同じ日への移動は押せない", () => {
    expect(canConfirmMoveCase({ ...OK, targetDayKey: "2026-12-01" })).toBe(
      false,
    );
  });

  it("★ 工事対応者が必要な環境で未選択なら押せない（既存の判定を残す）", () => {
    expect(
      canConfirmMoveCase({ ...OK, handlerRequired: true, handlerStaffId: "" }),
    ).toBe(false);
    expect(
      canConfirmMoveCase({
        ...OK,
        handlerRequired: true,
        handlerStaffId: "staff-1",
      }),
    ).toBe(true);
  });

  it("★ 案件やログインが揃っていなければ押せない", () => {
    expect(canConfirmMoveCase({ ...OK, canOpen: false })).toBe(false);
  });
});
