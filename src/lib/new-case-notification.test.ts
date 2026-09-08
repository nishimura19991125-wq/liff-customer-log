import { describe, expect, it } from "vitest";

import {
  NEW_CASE_NOTIFICATION_HEADING,
  buildNewCaseNotificationText,
} from "@/lib/new-case-notification";

/**
 * 新規案件通知の本文。
 *
 * 見出しの余白は運用側が決めた並びなので、**リテラルで固定して**守る。
 * ここが崩れたら通知の見た目が変わったということ。
 *
 * 改行の数まで含めて比較する。見出しの下に空行を入れ直したり行を足したり
 * したら落ちる。文面は運用側の依頼で決まるもので、こちらの判断で整形し直す
 * ものではないため、変わったことに気づけるようにしておく。
 */
describe("buildNewCaseNotificationText", () => {
  it("依頼どおりの並びで組み立てる", () => {
    const text = buildNewCaseNotificationText({
      tNumber: "T-1234",
      customerName: "山田太郎",
      creatorName: "西村",
    });

    expect(text).toBe(
      [
        "🎊契約おめでとうございます🎊",
        "T番号　 　 ：T-1234",
        "お客様名　 ：山田太郎",
        "案件作成者：西村",
      ].join("\n"),
    );
  });

  it("見出しの下に空行を入れない（見出しの次の行が T番号）", () => {
    const text = buildNewCaseNotificationText({
      tNumber: "T-1234",
      customerName: "山田太郎",
      creatorName: "西村",
    });
    const lines = text.split("\n");

    // 行数と改行の数を固定する。空行を戻したらどちらも合わなくなる
    expect(lines).toHaveLength(4);
    expect(lines.length - 1).toBe(3);
    expect(lines[0]).toBe(NEW_CASE_NOTIFICATION_HEADING);
    expect(lines[1]).toBe("T番号　 　 ：T-1234");
    expect(lines.filter((l) => l === "")).toHaveLength(0);
    expect(text).not.toContain("\n\n");
  });

  it("見出しは絵文字ごと固定", () => {
    expect(NEW_CASE_NOTIFICATION_HEADING).toBe("🎊契約おめでとうございます🎊");
  });

  it("値が空でも行は残す", () => {
    const text = buildNewCaseNotificationText({
      tNumber: "T-1234",
      customerName: "",
      creatorName: "",
    });

    expect(text.split("\n")).toEqual([
      "🎊契約おめでとうございます🎊",
      "T番号　 　 ：T-1234",
      "お客様名　 ：",
      "案件作成者：",
    ]);
  });

  it("@pocket の未入力表現（-）と前後の空白は出さない", () => {
    const text = buildNewCaseNotificationText({
      tNumber: "  T-1234  ",
      customerName: "-",
      creatorName: " 西村 ",
    });

    expect(text).toContain("T番号　 　 ：T-1234");
    expect(text).toContain("お客様名　 ：\n");
    expect(text).toContain("案件作成者：西村");
  });
});
