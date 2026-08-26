import { describe, expect, it } from "vitest";

import {
  buildKannaProjectName,
  KANNA_CONTRACTOR_UNDECIDED,
} from "@/lib/kanna-project-name";
import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";

const BASE: CustomerInfoFormValues = {
  customerName: "テスト　太郎",
  constructionContractor: "◯◯建設",
};

function build(over: CustomerInfoFormValues = {}): string {
  return buildKannaProjectName({ ...BASE, ...over });
}

describe("KANNA の案件名", () => {
  it("★ お客様名と施工業者が両方あれば {顧客名}様邸({施工業者})", () => {
    expect(build()).toBe("テスト　太郎様邸(◯◯建設)");
  });

  it("★ 施工業者が空欄なら「未定」を入れる（括弧は残す）", () => {
    expect(build({ constructionContractor: "" })).toBe("テスト　太郎様邸(未定)");
    expect(build({ constructionContractor: "   " })).toBe(
      "テスト　太郎様邸(未定)",
    );
    expect(KANNA_CONTRACTOR_UNDECIDED).toBe("未定");
  });

  it("★ @pocket の未入力表現「-」も「未定」として扱う", () => {
    expect(build({ constructionContractor: "-" })).toBe("テスト　太郎様邸(未定)");
  });

  it("★ 括弧は半角（全角の（）を使わない）", () => {
    const text = build();
    expect(text).toContain("(");
    expect(text).toContain(")");
    expect(text).not.toContain("（");
    expect(text).not.toContain("）");
  });

  it("★ お客様名と「様邸」の間にスペースを入れない", () => {
    expect(build()).toContain("太郎様邸");
    expect(build()).not.toContain("太郎 様邸");
    expect(build()).not.toContain("太郎　様邸");
  });

  it("★ お客様名の全角スペースを保持する（詰めない）", () => {
    // タイムツリー登録用と違い、@pocket の表記をそのまま使う
    expect(build({ customerName: "テスト　太郎" })).toBe(
      "テスト　太郎様邸(◯◯建設)",
    );
    expect(build({ customerName: "山田　花子" })).toContain("山田　花子様邸");
  });

  it("半角スペースの氏名もそのまま使う", () => {
    expect(build({ customerName: "テスト 太郎" })).toBe(
      "テスト 太郎様邸(◯◯建設)",
    );
  });

  it("姓のみの氏名も扱える", () => {
    expect(build({ customerName: "テスト" })).toBe("テスト様邸(◯◯建設)");
  });

  it("前後の空白は落とす", () => {
    expect(build({ customerName: " テスト　太郎 " })).toBe(
      "テスト　太郎様邸(◯◯建設)",
    );
    expect(build({ constructionContractor: " ◯◯建設 " })).toBe(
      "テスト　太郎様邸(◯◯建設)",
    );
  });

  /**
   * 施工業者は「未定」で代用できるが、お客様名は代替表現が無く
   * 案件名として成立しない。呼び出し側は空文字で「作成できません」を出す
   */
  it("★ お客様名が空なら空文字（案件名として成立しないため）", () => {
    expect(build({ customerName: "" })).toBe("");
    expect(build({ customerName: "   " })).toBe("");
    expect(build({ customerName: "-" })).toBe("");
    expect(build({ customerName: "", constructionContractor: "" })).toBe("");
  });
});
