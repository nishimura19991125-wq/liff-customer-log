import { describe, expect, it } from "vitest";

import {
  customerInfoFieldLabelMap,
  customerInfoFieldLabelsFromPocketError,
  customerInfoPutFailureMessage,
} from "@/lib/customer-info-form/pocket-error-fields";

/**
 * 保存が 400 で失敗したとき、原因の項目を画面に出す。
 *
 * これまでは「更新に失敗しました」しか出ず、利用者は何を直せばよいか
 * 分からないまま同じ操作を繰り返していた（追加部材の金額に「10000円」と
 * 入れて登録できない、という報告）。
 *
 * ここで固定するのは2つ。
 *   1. 引き直せたときは**見出しだけ**を出すこと
 *   2. 引き直せなければ従来の文言に落とすこと（推測で項目名を出さない）
 */

/** 実物と同じ形（updateRecord が投げるメッセージ） */
const RAW_400 =
  '@pocket update record failed: 400 {"errors":[{"field":"field-33","message":"数値で入力してください"}]}';

const LABELS = customerInfoFieldLabelMap([
  { fieldId: "field-33", label: "追加部材の金額" },
  { fieldId: "field-12", label: "現金" },
  { fieldId: "field-13", label: "ローン金額" },
]);

describe("customerInfoFieldLabelsFromPocketError", () => {
  it("★ 応答本文の列の識別名を見出しへ引き直す", () => {
    expect(customerInfoFieldLabelsFromPocketError(RAW_400, LABELS)).toEqual([
      "追加部材の金額",
    ]);
  });

  it("★ 複数見つかったら出てきた順に並べる", () => {
    const raw =
      "@pocket update record failed: 400 field-12 と field-33 が不正です";
    expect(customerInfoFieldLabelsFromPocketError(raw, LABELS)).toEqual([
      "現金",
      "追加部材の金額",
    ]);
  });

  it("同じ列が何度出ても1回だけ並べる", () => {
    const raw = "400 field-33 field-33 field_33";
    expect(customerInfoFieldLabelsFromPocketError(raw, LABELS)).toEqual([
      "追加部材の金額",
    ]);
  });

  it("field_101 の書き方でも引ける（uniqueId のゆれ）", () => {
    const labels = customerInfoFieldLabelMap([
      { fieldId: "field_101", label: "紹介手数料" },
    ]);
    expect(
      customerInfoFieldLabelsFromPocketError("400 field-101 が不正", labels),
    ).toEqual(["紹介手数料"]);
  });

  it("★ 多いときは先頭数件で丸める", () => {
    const many = customerInfoFieldLabelMap(
      Array.from({ length: 8 }, (_, i) => ({
        fieldId: `field-${i + 1}`,
        label: `項目${i + 1}`,
      })),
    );
    const raw = Array.from({ length: 8 }, (_, i) => `field-${i + 1}`).join(" ");

    const labels = customerInfoFieldLabelsFromPocketError(raw, many);

    expect(labels).toHaveLength(6);
    expect(labels.at(-1)).toBe("ほか3項目");
  });

  it("★ 引き直せない識別名は捨てる（field-XX を画面へ出さない）", () => {
    const raw = "400 field-99 が不正です";
    expect(customerInfoFieldLabelsFromPocketError(raw, LABELS)).toEqual([]);
  });

  it("★ 識別名が入っていなければ空", () => {
    expect(
      customerInfoFieldLabelsFromPocketError("400 Bad Request", LABELS),
    ).toEqual([]);
    expect(customerInfoFieldLabelsFromPocketError("", LABELS)).toEqual([]);
  });
});

describe("customerInfoPutFailureMessage", () => {
  it("★ 引き直せたときだけ、項目を並べた文言を返す", () => {
    expect(customerInfoPutFailureMessage(RAW_400, LABELS)).toBe(
      "更新に失敗しました。次の項目の値をご確認ください: 追加部材の金額",
    );
  });

  it("★ 引き直せなければ null（呼び出し側は従来の文言のまま）", () => {
    expect(customerInfoPutFailureMessage("400 Bad Request", LABELS)).toBeNull();
    expect(customerInfoPutFailureMessage("400 field-99", LABELS)).toBeNull();
  });

  it("★ 値・識別名・内部情報を文言に含めない", () => {
    const raw =
      '@pocket update record failed: 400 {"field":"field-33","value":"10000円"} | operation=customer-info:保存 | appsId=35 | apiKey=CUSTOMER_INFO_ATPOCKET_API_KEY_2';

    const message = customerInfoPutFailureMessage(raw, LABELS);

    expect(message).toContain("追加部材の金額");
    for (const leak of [
      "10000円",
      "field-33",
      "appsId",
      "35",
      "apiKey",
      "CUSTOMER_INFO_ATPOCKET_API_KEY_2",
      "operation",
      "@pocket",
      "400",
    ]) {
      expect(message, leak).not.toContain(leak);
    }
  });

  it("複数のときは読点で並べる", () => {
    const raw = "400 field-12 field-13";
    expect(customerInfoPutFailureMessage(raw, LABELS)).toBe(
      "更新に失敗しました。次の項目の値をご確認ください: 現金、ローン金額",
    );
  });
});

describe("customerInfoFieldLabelMap", () => {
  it("caption しか無くても引ける（旧方式の編集可能リスト）", () => {
    const map = customerInfoFieldLabelMap([
      { fieldId: "field-7", caption: "紹介手数料" },
    ]);
    expect(map.get("field-7")).toBe("紹介手数料");
  });

  it("識別名や見出しが空の行は入れない", () => {
    const map = customerInfoFieldLabelMap([
      { fieldId: "", label: "見出しだけ" },
      { fieldId: "field-8", label: "   " },
    ]);
    expect(map.size).toBe(0);
  });
});
