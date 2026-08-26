import { describe, expect, it } from "vitest";

import { APO_ACQUISITION_FIELD_SPECS } from "@/lib/apo-acquisition-fields";
import { APO_ACQUISITION_FIELD_KEYS } from "@/lib/apo-acquisition-types";

/**
 * 入力項目の定義。必須と選択肢はここが唯一の情報源で、
 * サーバの必須チェックも画面の「*」表示も同じ値を見ている
 * （クライアント側に別の必須判定は無い）。
 */

describe("必須項目", () => {
  it("★ 必須は7項目", () => {
    const required = APO_ACQUISITION_FIELD_KEYS.filter(
      (k) => APO_ACQUISITION_FIELD_SPECS[k].required,
    ).map((k) => APO_ACQUISITION_FIELD_SPECS[k].label);

    expect(required.sort()).toEqual(
      [
        "AP担当者",
        "アポ取得日",
        "アポ種別",
        "見積種別",
        "お客様名",
        "ギフト券",
        "アポランク",
      ].sort(),
    );
  });

  it("★ CL担当者・商談・資料送付予定日時は任意", () => {
    expect(APO_ACQUISITION_FIELD_SPECS.clStaff.required).toBe(false);
    expect(APO_ACQUISITION_FIELD_SPECS.scheduledDate.required).toBe(false);
  });

  it("★ ギフト券・アポランクは必須", () => {
    expect(APO_ACQUISITION_FIELD_SPECS.giftCoupon.required).toBe(true);
    expect(APO_ACQUISITION_FIELD_SPECS.apoRank.required).toBe(true);
  });

  it("その他メーカーは spec としては任意（「その他」選択時のみサーバで必須にする）", () => {
    expect(APO_ACQUISITION_FIELD_SPECS.otherManufacturer.required).toBe(false);
  });
});

describe("アポランクの選択肢", () => {
  it("★ A / B の2つだけ", () => {
    expect(APO_ACQUISITION_FIELD_SPECS.apoRank.options).toEqual(["A", "B"]);
  });

  it("★★ @pocket 側の選択肢に依存しない（fixedOptions）", () => {
    // これが無いと、@pocket に C / D が残っている場合に画面へ出てしまう
    expect(APO_ACQUISITION_FIELD_SPECS.apoRank.fixedOptions).toBe(true);
  });

  it("C / D は含まない", () => {
    expect(APO_ACQUISITION_FIELD_SPECS.apoRank.options).not.toContain("C");
    expect(APO_ACQUISITION_FIELD_SPECS.apoRank.options).not.toContain("D");
  });
});

describe("入力項目の増減", () => {
  it("★ 見積依頼内容は入力項目に無い", () => {
    expect(APO_ACQUISITION_FIELD_KEYS).not.toContain("estimateRequest");
  });

  it("★ 希望メーカー・その他メーカーが入力項目にある", () => {
    expect(APO_ACQUISITION_FIELD_KEYS).toContain("desiredManufacturer");
    expect(APO_ACQUISITION_FIELD_KEYS).toContain("otherManufacturer");
  });

  it("希望メーカーはテキスト型の列へカンマ区切りで書く", () => {
    const spec = APO_ACQUISITION_FIELD_SPECS.desiredManufacturer;
    expect(spec.kind).toBe("checkboxGroupText");
    expect(spec.options).toEqual(["SHARP", "XSOL", "Panasonic", "その他"]);
    // テキスト型なので @pocket からは選択肢を取れない
    expect(spec.fixedOptions).toBe(true);
  });

  it("★ 見出しが分からない2項目は識別名で引く", () => {
    expect(APO_ACQUISITION_FIELD_SPECS.desiredManufacturer.fallbackFieldId).toBe(
      "field-61",
    );
    expect(APO_ACQUISITION_FIELD_SPECS.otherManufacturer.fallbackFieldId).toBe(
      "field-60",
    );
    // 推測の見出し候補は書かない
    expect(APO_ACQUISITION_FIELD_SPECS.desiredManufacturer.captions).toEqual([]);
    expect(APO_ACQUISITION_FIELD_SPECS.otherManufacturer.captions).toEqual([]);
  });

  it("定義と表示順のキーが一致している", () => {
    expect(Object.keys(APO_ACQUISITION_FIELD_SPECS).sort()).toEqual(
      [...APO_ACQUISITION_FIELD_KEYS].sort(),
    );
  });
});
