import { describe, expect, it } from "vitest";

import {
  REFERRAL_SOURCE_NOT_MEMBER_NOTE,
  referralSourceNotMemberNote,
} from "@/lib/customer-info-form/referral-source-member";
import {
  referralSourceFieldPresentation,
  type ReferralSourceOptionsState,
} from "@/lib/customer-info-form/referral-source-options";

/**
 * 加盟店リストに無い紹介元は、サーバが保存を拒否する。
 * 画面では既存の値を選択肢に残したまま（何が入っていたか分かるように）、
 * 欄の下に「このままでは保存できない」ことを先に出す。
 */

const CLUB = "トラーチ倶楽部";
const OPTIONS = ["アオイ工業", "カトウ商店"];
const READY: ReferralSourceOptionsState = { status: "ready", options: OPTIONS };
const clubAp = { apStaff: CLUB, clStaff: "担当B" };

describe("★ 画面の選択肢に既存の値が出る", () => {
  it("リストに無い既存の値も選択肢に残す（mergeStaffNameOptions のまま）", () => {
    const p = referralSourceFieldPresentation({ ...clubAp, referralSource: "A商事" }, READY);
    expect(p.type).toBe("select");
    expect(p.options).toContain("A商事");
  });
});

describe("★ リストに無い値は、保存前に画面で気づける", () => {
  it("トラーチ倶楽部の案件でリストに無ければ説明を出す", () => {
    expect(
      referralSourceNotMemberNote({ ...clubAp, referralSource: "A商事" }, READY),
    ).toBe(REFERRAL_SOURCE_NOT_MEMBER_NOTE);
  });

  it("説明は何をすればよいか分かり、内部の事情を出さない", () => {
    expect(REFERRAL_SOURCE_NOT_MEMBER_NOTE).toContain("候補から選び直してください");
    expect(REFERRAL_SOURCE_NOT_MEMBER_NOTE).not.toMatch(/field-|アプリ|ID/);
  });

  it("リストにある値なら出さない（全角半角の違いは同じ扱い）", () => {
    expect(
      referralSourceNotMemberNote({ ...clubAp, referralSource: "カトウ商店" }, READY),
    ).toBeNull();
    expect(
      referralSourceNotMemberNote(
        { ...clubAp, referralSource: " ＡＢＣ " },
        { status: "ready", options: ["ABC"] },
      ),
    ).toBeNull();
  });

  it("空なら出さない（必須の表示で足りる）", () => {
    expect(referralSourceNotMemberNote({ ...clubAp, referralSource: "" }, READY)).toBeNull();
  });

  it("トラーチ倶楽部でない案件では出さない", () => {
    expect(
      referralSourceNotMemberNote(
        { apStaff: "担当A", clStaff: "担当B", referralSource: "A商事" },
        READY,
      ),
    ).toBeNull();
  });

  it("一覧を読めていないときは出さない（リストに無いとは言えない）", () => {
    for (const state of [
      { status: "failed" },
      { status: "loading" },
      { status: "idle" },
      { status: "ready", options: [] },
    ] as ReferralSourceOptionsState[]) {
      expect(
        referralSourceNotMemberNote({ ...clubAp, referralSource: "A商事" }, state),
        state.status,
      ).toBeNull();
    }
  });
});
