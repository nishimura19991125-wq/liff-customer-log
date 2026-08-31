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
        "🐣新規案件が追加されました🐣",
        "",
        "T番号　 　 ：T-1234",
        "お客様名　 ：山田太郎",
        "案件作成者：西村",
      ].join("\n"),
    );
  });

  it("見出しは絵文字ごと固定", () => {
    expect(NEW_CASE_NOTIFICATION_HEADING).toBe("🐣新規案件が追加されました🐣");
  });

  it("値が空でも行は残す", () => {
    const text = buildNewCaseNotificationText({
      tNumber: "T-1234",
      customerName: "",
      creatorName: "",
    });

    expect(text.split("\n")).toEqual([
      "🐣新規案件が追加されました🐣",
      "",
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
