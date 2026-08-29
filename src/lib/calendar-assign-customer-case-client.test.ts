import { describe, expect, it } from "vitest";

import {
  ASSIGN_CUSTOMER_CASE_PATH,
  assignedCaseSuccessMessage,
} from "@/lib/calendar-assign-customer-case-client";

/**
 * 第3段階 3-3・案B: 画面の送信先と成功文言。
 *
 * ここで固定するのは次の4つ。
 *   - 送信先が新ルートであること（旧ルートに戻っていない）
 *   - existing（空き枠へは書かなかった）を利用者に伝えること
 *   - existing で**空き枠を削除したかどうか**を必ず伝えること
 *     押した枠が消える／消えないは見た目が変わるので、黙ってはいけない
 *   - 起きていないことを起きたように書かないこと
 */

describe("送信先", () => {
  it("★ 3-2 で追加した割り当て API を指す", () => {
    expect(ASSIGN_CUSTOMER_CASE_PATH).toBe(
      "/api/calendar/assign-customer-case",
    );
  });

  it("★ 空き枠を削除する旧ルートではない", () => {
    expect(ASSIGN_CUSTOMER_CASE_PATH).not.toContain("assign-case-to-slot");
    expect(ASSIGN_CUSTOMER_CASE_PATH).not.toContain("schedule-undated-case");
  });
});

describe("成功文言", () => {
  it("★ existing は「空き枠へ書かなかった」と理由を伝える", () => {
    const msg = assignedCaseSuccessMessage({
      ok: true,
      assignedTo: "existing",
    });
    expect(msg).toContain("既にあった");
    expect(msg).toContain("空き枠には書き込んでいません");
    // 押した枠が変わらない理由まで書く
    expect(msg).toContain("2件にならない");
  });

  it("★ existing で枠を削除したら、そう伝える", () => {
    const msg = assignedCaseSuccessMessage({
      ok: true,
      assignedTo: "existing",
      slotRecordId: "slot-9",
      slotDeleted: true,
    });
    expect(msg).toContain("選んだ空き枠は削除しました");
  });

  it("★ existing で枠を削除できなかったら、理由ごと伝える", () => {
    const msg = assignedCaseSuccessMessage({
      ok: true,
      assignedTo: "existing",
      slotRecordId: "slot-9",
      slotDeleted: false,
      slotDeleteWarning: "先に別の案件が入っていたため",
    });
    expect(msg).toContain("削除していません");
    expect(msg).toContain("先に別の案件が入っていたため");
    expect(msg).toContain("カレンダーを確認");
  });

  it("理由が来なくても文言が壊れない", () => {
    const msg = assignedCaseSuccessMessage({
      assignedTo: "existing",
      slotRecordId: "slot-9",
      slotDeleted: false,
    });
    expect(msg).toContain("削除していません");
  });

  it("★ 枠を選んでいなければ枠の話をしない", () => {
    const msg = assignedCaseSuccessMessage({
      ok: true,
      assignedTo: "existing",
    });
    expect(msg).not.toContain("削除しました");
    expect(msg).not.toContain("削除していません");
  });

  it("★ slot は削除していないと明示する", () => {
    const msg = assignedCaseSuccessMessage({ ok: true, assignedTo: "slot" });
    expect(msg).toContain("削除していません");
    expect(msg).toContain("Aki番号");
  });

  it("new は新規登録と伝える", () => {
    const msg = assignedCaseSuccessMessage({ ok: true, assignedTo: "new" });
    expect(msg).toContain("新しく登録");
  });

  it("★ どの経路でも「削除されます」と予告しない（結果だけ書く）", () => {
    for (const target of ["existing", "slot", "new", undefined] as const) {
      const msg = assignedCaseSuccessMessage({
        ok: true,
        assignedTo: target,
        customerInfoSynced: true,
      });
      expect(msg).not.toContain("削除されます");
    }
  });

  it("★ slot 経路では削除の話にならない（枠は案件に変わるだけ）", () => {
    const msg = assignedCaseSuccessMessage({
      assignedTo: "slot",
      slotRecordId: "slot-9",
      slotUsed: true,
      slotDeleted: false,
    });
    expect(msg).toContain("削除していません");
    expect(msg).not.toContain("選んだ空き枠は削除しました");
  });

  it("お客様情報へ連携できたときだけその旨を足す", () => {
    const synced = assignedCaseSuccessMessage({
      assignedTo: "slot",
      customerInfoSynced: true,
    });
    const notSynced = assignedCaseSuccessMessage({ assignedTo: "slot" });
    expect(synced).toContain("お客様情報");
    expect(notSynced).not.toContain("お客様情報");
  });

  it("assignedTo が無くても文言が壊れない", () => {
    expect(assignedCaseSuccessMessage({})).toContain("割り当てました");
  });
});
