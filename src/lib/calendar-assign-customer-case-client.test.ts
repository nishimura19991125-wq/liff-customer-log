import { describe, expect, it } from "vitest";

import {
  ASSIGN_CUSTOMER_CASE_PATH,
  assignedCaseSuccessMessage,
} from "@/lib/calendar-assign-customer-case-client";

/**
 * 第3段階 3-3: 画面の送信先と成功文言。
 *
 * ここで固定するのは次の3つ。
 *   - 送信先が新ルートであること（旧ルートに戻っていない）
 *   - 削除を前提にした文言が残っていないこと
 *   - existing（空き枠を使わなかった）を利用者に伝えること
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
  it("★ existing は「空き枠を使わなかった」と理由を伝える", () => {
    const msg = assignedCaseSuccessMessage({
      ok: true,
      assignedTo: "existing",
    });
    expect(msg).toContain("既にあった");
    expect(msg).toContain("空き枠は使わず");
    // 押した枠が変わらない理由まで書く
    expect(msg).toContain("2件にならない");
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

  it("★ どの経路でも「削除されます」と言わない", () => {
    for (const target of ["existing", "slot", "new", undefined] as const) {
      const msg = assignedCaseSuccessMessage({
        ok: true,
        assignedTo: target,
        customerInfoSynced: true,
      });
      expect(msg).not.toContain("削除されます");
    }
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
