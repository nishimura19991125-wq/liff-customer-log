import { afterEach, describe, expect, it } from "vitest";

import {
  assignDeletesEmptySlotEnabled,
  decideEmptySlotDeletion,
  emptySlotDeleteRefusalIsNotable,
  emptySlotDeleteRefusalMessage,
} from "@/lib/calendar-assign-slot-delete-guard";

/**
 * 未定案件の割り当て（案B）で、空き枠を物理削除してよいかの判定。
 *
 * ここで固定するのは「消してよい条件」ではなく **「消してはいけない条件」**。
 * 物理削除は取り返しがつかないので、判定が緩む変更をテストで落とす。
 */

const NAME_ID = "field-2";
const DATE_ID = "field-3";

/** 空き枠＝お客様名が空で施工予定日が読める行 */
const EMPTY_SLOT: Record<string, unknown> = {
  [NAME_ID]: "",
  [DATE_ID]: "2026-12-05",
};

function decide(over: Partial<Parameters<typeof decideEmptySlotDeletion>[0]>) {
  return decideEmptySlotDeletion({
    enabled: true,
    slotRecordId: "slot-9",
    existingRecordId: "con-55",
    freshSlotRecord: { ...EMPTY_SLOT },
    customerNameFieldId: NAME_ID,
    startDateFieldId: DATE_ID,
    ...over,
  });
}

describe("消してよいとき", () => {
  it("★ 空き枠で、既存レコードと別IDなら削除できる", () => {
    expect(decide({})).toEqual({ ok: true });
  });

  it("日付が {value} 形式でも読めれば削除できる", () => {
    expect(
      decide({
        freshSlotRecord: { [NAME_ID]: "", [DATE_ID]: { value: "2026-12-05" } },
      }),
    ).toEqual({ ok: true });
  });

  it("日付が 2026/12/05 形式でも読める", () => {
    expect(
      decide({ freshSlotRecord: { [NAME_ID]: "", [DATE_ID]: "2026/12/05" } }),
    ).toEqual({ ok: true });
  });

  it("お客様名が空白だけなら空き枠として扱う", () => {
    expect(
      decide({ freshSlotRecord: { [NAME_ID]: "　 ", [DATE_ID]: "2026-12-05" } }),
    ).toEqual({ ok: true });
  });
});

describe("消してはいけないとき", () => {
  it("★ 無効化されていたら消さない", () => {
    expect(decide({ enabled: false })).toEqual({
      ok: false,
      reason: "disabled",
    });
  });

  it("★ 空き枠が指定されていなければ消さない", () => {
    expect(decide({ slotRecordId: "" })).toEqual({
      ok: false,
      reason: "no_slot",
    });
    expect(decide({ slotRecordId: "   " })).toEqual({
      ok: false,
      reason: "no_slot",
    });
  });

  it("★ 書き込み先の既存レコードIDが分からなければ消さない", () => {
    expect(decide({ existingRecordId: "" })).toEqual({
      ok: false,
      reason: "unknown_existing",
    });
  });

  it("★ 空き枠と既存レコードが同一IDなら消さない", () => {
    expect(decide({ existingRecordId: "slot-9" })).toEqual({
      ok: false,
      reason: "same_record",
    });
  });

  it("★ 削除直前のレコードを取得できていなければ消さない", () => {
    expect(decide({ freshSlotRecord: null })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("★ もう空き枠でない（別の案件が入っている）なら消さない", () => {
    expect(
      decide({
        freshSlotRecord: { [NAME_ID]: "鈴木 花子", [DATE_ID]: "2026-12-05" },
      }),
    ).toEqual({ ok: false, reason: "occupied" });
  });

  it("★ 施工予定日が読めなければ消さない", () => {
    expect(
      decide({ freshSlotRecord: { [NAME_ID]: "", [DATE_ID]: "" } }),
    ).toEqual({ ok: false, reason: "no_start_date" });
    expect(decide({ freshSlotRecord: { [NAME_ID]: "" } })).toEqual({
      ok: false,
      reason: "no_start_date",
    });
    expect(
      decide({ freshSlotRecord: { [NAME_ID]: "", [DATE_ID]: "2026-13-40" } }),
    ).toEqual({ ok: false, reason: "no_start_date" });
  });

  it("お客様名の列が解決できていないときは空き枠と見なさない", () => {
    // constructionTitleFieldIsEmpty は列IDが空なら false を返す（＝空でない）
    expect(decide({ customerNameFieldId: "" })).toEqual({
      ok: false,
      reason: "occupied",
    });
  });

  it("判定の順序: 無効化は他のどの条件よりも先に効く", () => {
    expect(
      decide({
        enabled: false,
        slotRecordId: "",
        existingRecordId: "",
        freshSlotRecord: null,
      }),
    ).toEqual({ ok: false, reason: "disabled" });
  });
});

describe("環境変数", () => {
  const saved = process.env.CALENDAR_ASSIGN_DELETE_EMPTY_SLOT;
  afterEach(() => {
    if (saved === undefined) {
      delete process.env.CALENDAR_ASSIGN_DELETE_EMPTY_SLOT;
    } else {
      process.env.CALENDAR_ASSIGN_DELETE_EMPTY_SLOT = saved;
    }
  });

  it("★ 未設定なら有効（既定で削除する）", () => {
    delete process.env.CALENDAR_ASSIGN_DELETE_EMPTY_SLOT;
    expect(assignDeletesEmptySlotEnabled()).toBe(true);
  });

  it("★ false / 0 のときだけ無効", () => {
    process.env.CALENDAR_ASSIGN_DELETE_EMPTY_SLOT = "false";
    expect(assignDeletesEmptySlotEnabled()).toBe(false);
    process.env.CALENDAR_ASSIGN_DELETE_EMPTY_SLOT = "0";
    expect(assignDeletesEmptySlotEnabled()).toBe(false);
  });

  it("true・その他の値は有効のまま", () => {
    process.env.CALENDAR_ASSIGN_DELETE_EMPTY_SLOT = "true";
    expect(assignDeletesEmptySlotEnabled()).toBe(true);
    process.env.CALENDAR_ASSIGN_DELETE_EMPTY_SLOT = "1";
    expect(assignDeletesEmptySlotEnabled()).toBe(true);
    process.env.CALENDAR_ASSIGN_DELETE_EMPTY_SLOT = "  ";
    expect(assignDeletesEmptySlotEnabled()).toBe(true);
  });
});

describe("見送った理由の伝え方", () => {
  it("★ 通常運転の理由は利用者に伝えない", () => {
    expect(emptySlotDeleteRefusalIsNotable("no_slot")).toBe(false);
    expect(emptySlotDeleteRefusalIsNotable("disabled")).toBe(false);
  });

  it("★ 想定外の理由は伝える", () => {
    for (const r of [
      "occupied",
      "not_found",
      "same_record",
      "no_start_date",
      "unknown_existing",
    ] as const) {
      expect(emptySlotDeleteRefusalIsNotable(r)).toBe(true);
      expect(emptySlotDeleteRefusalMessage(r)).not.toBe("");
    }
  });

  it("伝えない理由の文言は空", () => {
    expect(emptySlotDeleteRefusalMessage("no_slot")).toBe("");
    expect(emptySlotDeleteRefusalMessage("disabled")).toBe("");
  });
});
