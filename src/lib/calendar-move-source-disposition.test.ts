import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decideMoveSourceDeletion,
  moveDeletesSourceRecordEnabled,
  moveSourceDeleteRefusalIsNotable,
  moveSourceDeleteRefusalMessage,
  moveSourceDispositionFromBody,
  moveSourceKeptInsteadOfDeleteMessage,
  type MoveSourceDeleteRefusal,
} from "@/lib/calendar-move-source-disposition";

/**
 * 工事日変更 M-4: 移動元のレコードを削除してよいかの判定。
 *
 * 物理削除なので、ここで固定するのは「消してよい条件」ではなく
 * **消してはいけない条件が1つでも当たれば ok を返さないこと**。
 * 呼び出し側は ok のときだけ消し、それ以外は空き枠へ戻す。
 */

const NAME_ID = "field-name";
const T_ID = "field-t";

type DecideInput = Parameters<typeof decideMoveSourceDeletion>[0];

/** すべての条件を満たした入力。各テストは1つだけ崩す */
const OK: DecideInput = {
  enabled: true,
  disposition: "delete",
  sourceRecordId: "5001",
  movedRecordId: "5002",
  movedWritten: true,
  freshSourceRecord: {
    [NAME_ID]: "山田 太郎",
    [T_ID]: "T00003420",
  },
  customerNameFieldId: NAME_ID,
  tNumberFieldId: T_ID,
  expectedTNumber: "T00003420",
};

function refuse(
  over: Partial<DecideInput>,
): { ok: false; reason: MoveSourceDeleteRefusal } {
  const out = decideMoveSourceDeletion({ ...OK, ...over });
  if (out.ok) throw new Error("削除を許可してしまった");
  return out;
}

describe("body の読み取り", () => {
  it("★ delete のときだけ削除。それ以外はすべて keep", () => {
    expect(moveSourceDispositionFromBody("delete")).toBe("delete");
    expect(moveSourceDispositionFromBody("keep")).toBe("keep");
  });

  it("★ 送られてこなければ keep（古いクライアントが消す側へ倒れない）", () => {
    expect(moveSourceDispositionFromBody(undefined)).toBe("keep");
    expect(moveSourceDispositionFromBody(null)).toBe("keep");
  });

  it("★ 知らない値・型違いはすべて keep", () => {
    for (const raw of ["DELETE", "true", true, 1, {}, [], ""]) {
      expect(moveSourceDispositionFromBody(raw), String(raw)).toBe("keep");
    }
  });

  it("前後の空白は落とす", () => {
    expect(moveSourceDispositionFromBody("  delete  ")).toBe("delete");
  });
});

describe("環境変数（CALENDAR_ASSIGN_DELETE_EMPTY_SLOT と同型）", () => {
  const saved = process.env.CALENDAR_MOVE_DELETE_SOURCE_RECORD;

  beforeEach(() => {
    delete process.env.CALENDAR_MOVE_DELETE_SOURCE_RECORD;
  });
  afterEach(() => {
    if (saved === undefined) {
      delete process.env.CALENDAR_MOVE_DELETE_SOURCE_RECORD;
    } else {
      process.env.CALENDAR_MOVE_DELETE_SOURCE_RECORD = saved;
    }
  });

  it("★ 未設定なら有効", () => {
    expect(moveDeletesSourceRecordEnabled()).toBe(true);
  });

  it("★ false / 0 で止まる", () => {
    process.env.CALENDAR_MOVE_DELETE_SOURCE_RECORD = "false";
    expect(moveDeletesSourceRecordEnabled()).toBe(false);
    process.env.CALENDAR_MOVE_DELETE_SOURCE_RECORD = "0";
    expect(moveDeletesSourceRecordEnabled()).toBe(false);
  });

  it("★ true やその他の値では止まらない", () => {
    process.env.CALENDAR_MOVE_DELETE_SOURCE_RECORD = "true";
    expect(moveDeletesSourceRecordEnabled()).toBe(true);
    process.env.CALENDAR_MOVE_DELETE_SOURCE_RECORD = "1";
    expect(moveDeletesSourceRecordEnabled()).toBe(true);
  });

  it("★ 止めても削除するのは disposition 次第（既定で消えるわけではない）", () => {
    // enabled=true でも keep なら消さない
    expect(refuse({ disposition: "keep" }).reason).toBe("keep_requested");
  });
});

describe("削除してよい条件", () => {
  it("★ すべて満たせば ok", () => {
    expect(decideMoveSourceDeletion(OK)).toEqual({ ok: true });
  });

  it("★ 環境変数で止められていたら消さない", () => {
    expect(refuse({ enabled: false }).reason).toBe("disabled");
  });

  it("★ 「残す」を選んでいたら消さない（既定）", () => {
    expect(refuse({ disposition: "keep" }).reason).toBe("keep_requested");
  });

  it("★ W1 を書いていなければ消さない", () => {
    expect(refuse({ movedWritten: false }).reason).toBe("not_written");
  });

  it("★ 移動先のレコードIDが分からなければ消さない", () => {
    expect(refuse({ movedRecordId: "" }).reason).toBe("unknown_target");
    expect(refuse({ movedRecordId: "   " }).reason).toBe("unknown_target");
  });

  it("★ 移動元と移動先が同じレコードなら消さない", () => {
    expect(refuse({ movedRecordId: "5001" }).reason).toBe("same_record");
  });

  it("★ 移動元のレコードIDが空なら消さない", () => {
    expect(refuse({ sourceRecordId: "" }).reason).toBe("same_record");
  });

  it("★ 全項目を取り直せていなければ消さない", () => {
    expect(refuse({ freshSourceRecord: null }).reason).toBe("not_found");
  });

  it("★ 既に空き枠になっていたら消さない（空き枠を消さない）", () => {
    expect(
      refuse({ freshSourceRecord: { [NAME_ID]: "", [T_ID]: "T00003420" } })
        .reason,
    ).toBe("already_empty");
  });

  it("★ 別の案件に変わっていたら消さない", () => {
    expect(
      refuse({
        freshSourceRecord: { [NAME_ID]: "鈴木 花子", [T_ID]: "T00009999" },
      }).reason,
    ).toBe("changed");
  });

  it("★ T番号 が空なら消さない（空き枠へ戻す側と扱いを変える）", () => {
    // 空き枠へ戻す側は「空なら進む」で通している。更新は取り返しがつくが
    // 削除はつかないので、同じ案件だと確かめられないものは消さない
    expect(
      refuse({ freshSourceRecord: { [NAME_ID]: "山田 太郎" } }).reason,
    ).toBe("no_t_number");
    expect(
      refuse({ freshSourceRecord: { [NAME_ID]: "山田 太郎", [T_ID]: "  " } })
        .reason,
    ).toBe("no_t_number");
  });

  it("★ 期待する T番号 が空でも消さない", () => {
    expect(refuse({ expectedTNumber: "" }).reason).toBe("no_t_number");
  });

  it("★ 列を特定できていなければ消さない", () => {
    // constructionTitleFieldIsEmpty は列 ID が空だと false を返す。
    // ここで止めないと「読めていないだけ」で削除まで通る
    expect(refuse({ customerNameFieldId: "" }).reason).toBe("unresolved_field");
    expect(refuse({ tNumberFieldId: "" }).reason).toBe("unresolved_field");
  });

  it("T番号 の表記ゆれ（空白）は一致として扱う", () => {
    expect(
      decideMoveSourceDeletion({
        ...OK,
        freshSourceRecord: { [NAME_ID]: "山田 太郎", [T_ID]: " T00003420 " },
      }),
    ).toEqual({ ok: true });
  });
});

describe("見送ったときの伝え方", () => {
  it("★ 既定の動作と運用停止は利用者に言わない", () => {
    expect(moveSourceDeleteRefusalIsNotable("keep_requested")).toBe(false);
    expect(moveSourceDeleteRefusalIsNotable("disabled")).toBe(false);
  });

  it("★ それ以外は伝える（黙って残さない）", () => {
    for (const r of [
      "same_record",
      "unknown_target",
      "not_written",
      "not_found",
      "already_empty",
      "changed",
      "no_t_number",
      "unresolved_field",
    ] as const) {
      expect(moveSourceDeleteRefusalIsNotable(r), r).toBe(true);
      expect(moveSourceDeleteRefusalMessage(r), r).not.toBe("");
    }
  });

  it("★ 伝えるときは、空き枠として残したことまで言う", () => {
    expect(moveSourceKeptInsteadOfDeleteMessage("changed")).toBe(
      "移動元が別の案件に変わっていたため、移動元は削除せず空き枠として残しました。",
    );
  });

  it("★ 言わない理由では文言を作らない", () => {
    expect(moveSourceKeptInsteadOfDeleteMessage("keep_requested")).toBe("");
    expect(moveSourceKeptInsteadOfDeleteMessage("disabled")).toBe("");
  });
});
