import { describe, expect, it } from "vitest";

import {
  INTRODUCTION_ROUTE_OPTIONS,
  INTRODUCTION_ROUTES_WITH_REFERRAL_SOURCE,
  REFERRAL_SOURCE_FIELD_KEYS,
  shouldShowReferralSourceFields,
} from "@/lib/customer-info-form/options";
import {
  applyCustomerInfoHiddenDefaultsToValues,
  buildCustomerInfoFormPayload,
  isCustomerInfoFormFieldVisible,
} from "@/lib/customer-info-form/rules";
import {
  CUSTOMER_INFO_FORM_FIELDS,
  CUSTOMER_INFO_FORM_FIELD_MAP,
} from "@/lib/customer-info-form/schema";
import {
  findMissingRequiredCustomerInfoFields,
  isCustomerInfoFieldRequired,
} from "@/lib/customer-info-form/validate";
import type {
  CustomerInfoFormFieldResolved,
  CustomerInfoFormValues,
} from "@/lib/customer-info-form/types";

/**
 * 条件A：導入経緯で出し分ける 紹介元・紹介手数料。
 *
 * 対象6値のときだけ表示。それ以外・未選択では表示しない。
 * 隠れているあいだは @pocket を一切触らない（"-" も 0 も書かない）。
 */

const REFERRAL_SOURCE = "referralSource";
const REFERRAL_FEE = "referralFee";

/** 条件A の対象になる導入経緯（@pocket の実物どおり） */
const SHOWN_ROUTES = [
  "(DC)工務店OBリスト",
  "ソーラーパートナーズ",
  "タイナビ",
  "工務店トスアップ",
  "お客様紹介",
  "お取引先様からの紹介",
];

/** 条件A の対象外の導入経緯 */
const HIDDEN_ROUTES = INTRODUCTION_ROUTE_OPTIONS.filter(
  (v) => !SHOWN_ROUTES.includes(v),
);

function resolveAll(): CustomerInfoFormFieldResolved[] {
  return CUSTOMER_INFO_FORM_FIELDS.map((f) => ({
    ...f,
    fieldId: f.liffOnly ? "" : f.key,
    label: f.caption,
    value: "",
  }));
}

const RESOLVED = resolveAll();

function payloadFor(values: CustomerInfoFormValues): Record<string, unknown> {
  return buildCustomerInfoFormPayload(values, RESOLVED);
}

function validateFieldFor(key: string) {
  const def = CUSTOMER_INFO_FORM_FIELD_MAP.get(key);
  if (!def) throw new Error(`schema に無いキー: ${key}`);
  return {
    key: def.key,
    label: def.caption,
    type: def.type,
    required: def.required,
  };
}

describe("スキーマ上の定義と並び", () => {
  it("★ 紹介元は caption「紹介元」・text・任意", () => {
    const def = CUSTOMER_INFO_FORM_FIELD_MAP.get(REFERRAL_SOURCE);
    expect(def?.caption).toBe("紹介元");
    expect(def?.type).toBe("text");
    expect(def?.required).toBe(false);
    // @pocket へ保存する項目（画面だけの項目ではない）
    expect(def?.liffOnly).toBeFalsy();
    expect(def?.hiddenInForm).toBeFalsy();
  });

  it("★ 紹介手数料は key・caption・型が変わっていない", () => {
    const def = CUSTOMER_INFO_FORM_FIELD_MAP.get(REFERRAL_FEE);
    expect(def?.caption).toBe("紹介手数料");
    expect(def?.type).toBe("comma-integer");
    expect(def?.liffOnly).toBeFalsy();
    expect(def?.hiddenInForm).toBeFalsy();
  });

  it("★ 並びが 導入経緯 → 紹介元 → 紹介手数料 になっている", () => {
    const keys = CUSTOMER_INFO_FORM_FIELDS.map((f) => f.key);
    const i = keys.indexOf("introduction");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(keys[i + 1]).toBe(REFERRAL_SOURCE);
    expect(keys[i + 2]).toBe(REFERRAL_FEE);
  });

  it("対象キーの集合は紹介元・紹介手数料の2つ", () => {
    expect([...REFERRAL_SOURCE_FIELD_KEYS].sort()).toEqual(
      [REFERRAL_SOURCE, REFERRAL_FEE].sort(),
    );
  });
});

describe("導入経緯の選択肢に条件A の6値があるか", () => {
  /**
   * 1つでも欠けていると、その導入経緯を選んだときに欄が出ない。
   * 現状「お取引先様からの紹介」だけが選択肢に無い（@pocket 側の追加待ち）。
   */
  it("★ 5値は選択肢にあり、「お取引先様からの紹介」だけ無い", () => {
    const present = SHOWN_ROUTES.filter((v) =>
      (INTRODUCTION_ROUTE_OPTIONS as readonly string[]).includes(v),
    );
    const missing = SHOWN_ROUTES.filter(
      (v) => !(INTRODUCTION_ROUTE_OPTIONS as readonly string[]).includes(v),
    );
    expect(present).toEqual([
      "(DC)工務店OBリスト",
      "ソーラーパートナーズ",
      "タイナビ",
      "工務店トスアップ",
      "お客様紹介",
    ]);
    expect(missing).toEqual(["お取引先様からの紹介"]);
  });

  it("条件A の集合はコード上6値ちょうど", () => {
    expect([...INTRODUCTION_ROUTES_WITH_REFERRAL_SOURCE].sort()).toEqual(
      [...SHOWN_ROUTES].sort(),
    );
  });
});

describe("shouldShowReferralSourceFields（判定はこの1関数に集約）", () => {
  for (const route of SHOWN_ROUTES) {
    it(`「${route}」なら true`, () => {
      expect(shouldShowReferralSourceFields({ introduction: route })).toBe(true);
    });
  }

  for (const route of HIDDEN_ROUTES) {
    it(`「${route}」なら false`, () => {
      expect(shouldShowReferralSourceFields({ introduction: route })).toBe(
        false,
      );
    });
  }

  it("未選択（空）なら false", () => {
    expect(shouldShowReferralSourceFields({ introduction: "" })).toBe(false);
    expect(shouldShowReferralSourceFields({})).toBe(false);
  });

  it("前後の空白は落として比較する", () => {
    expect(shouldShowReferralSourceFields({ introduction: " タイナビ " })).toBe(
      true,
    );
  });
});

describe("表示：導入経緯6値のとき2項目が出る", () => {
  for (const route of SHOWN_ROUTES) {
    it(`★ 「${route}」で紹介元・紹介手数料が表示される`, () => {
      const values = { introduction: route };
      for (const key of REFERRAL_SOURCE_FIELD_KEYS) {
        expect(isCustomerInfoFormFieldVisible(key, values), key).toBe(true);
      }
    });
  }
});

describe("表示：それ以外・未選択のときは出ない", () => {
  for (const route of [...HIDDEN_ROUTES, ""]) {
    const label = route === "" ? "未選択" : route;
    it(`★ 「${label}」で紹介元・紹介手数料が表示されない`, () => {
      const values = { introduction: route };
      for (const key of REFERRAL_SOURCE_FIELD_KEYS) {
        expect(isCustomerInfoFormFieldVisible(key, values), key).toBe(false);
      }
    });
  }
});

describe("必須", () => {
  it("★ 紹介元は表示中でも任意（未入力でも保存できる）", () => {
    const values = { introduction: "お客様紹介", [REFERRAL_SOURCE]: "" };
    expect(isCustomerInfoFieldRequired(validateFieldFor(REFERRAL_SOURCE), values)).toBe(
      false,
    );
    const missing = findMissingRequiredCustomerInfoFields(
      [validateFieldFor(REFERRAL_SOURCE)],
      values,
    );
    expect(missing).toHaveLength(0);
  });

  it("紹介手数料は表示中なら従来どおり必須", () => {
    const missing = findMissingRequiredCustomerInfoFields(
      [validateFieldFor(REFERRAL_FEE)],
      { introduction: "タイナビ", [REFERRAL_FEE]: "" },
    );
    expect(missing.map((f) => f.key)).toEqual([REFERRAL_FEE]);
  });

  it("★ 非表示なら2項目とも必須にならない", () => {
    for (const route of [...HIDDEN_ROUTES, ""]) {
      const missing = findMissingRequiredCustomerInfoFields(
        [validateFieldFor(REFERRAL_SOURCE), validateFieldFor(REFERRAL_FEE)],
        { introduction: route, [REFERRAL_SOURCE]: "", [REFERRAL_FEE]: "" },
      );
      expect(missing, route || "未選択").toHaveLength(0);
    }
  });
});

describe("保存：非表示のとき payload に含めない", () => {
  it('★ 値の有無にかかわらず2項目とも送らない（"-" も 0 も書かない）', () => {
    for (const route of [...HIDDEN_ROUTES, ""]) {
      for (const raw of ["", "-", "0", "A商事", "50,000"]) {
        const p = payloadFor({
          introduction: route,
          [REFERRAL_SOURCE]: raw,
          [REFERRAL_FEE]: raw,
        });
        const label = `${route || "未選択"} / ${raw}`;
        expect(p, label).not.toHaveProperty(REFERRAL_SOURCE);
        expect(p, label).not.toHaveProperty(REFERRAL_FEE);
      }
    }
  });

  it("★ 導入経緯を変えても @pocket の既存値を消さない", () => {
    // 表示 → 非表示へ切り替えた直後の values で保存しても、2項目は送らない
    const shown = payloadFor({
      introduction: "お客様紹介",
      [REFERRAL_SOURCE]: "A商事",
      [REFERRAL_FEE]: "50,000",
    });
    expect(shown[REFERRAL_SOURCE]).toBe("A商事");
    expect(shown[REFERRAL_FEE]).toBe("50000");

    const hidden = payloadFor({
      introduction: "ダイレクト",
      [REFERRAL_SOURCE]: "A商事",
      [REFERRAL_FEE]: "50,000",
    });
    expect(hidden).not.toHaveProperty(REFERRAL_SOURCE);
    expect(hidden).not.toHaveProperty(REFERRAL_FEE);
  });
});

describe("保存：表示中は従来どおり", () => {
  it("★ 紹介手数料はカンマを外した整数で送る（書式が変わっていない）", () => {
    const p = payloadFor({
      introduction: "タイナビ",
      [REFERRAL_FEE]: "1,234,567",
    });
    expect(p[REFERRAL_FEE]).toBe("1234567");
  });

  it("★ 紹介手数料は単位付きで入れてもカンマなしの整数で送る", () => {
    const p = payloadFor({
      introduction: "タイナビ",
      [REFERRAL_FEE]: "10000円",
    });
    expect(p[REFERRAL_FEE]).toBe("10000");
  });

  it("表示中に空なら紹介手数料は 0（従来どおり）", () => {
    const p = payloadFor({ introduction: "タイナビ", [REFERRAL_FEE]: "" });
    expect(p[REFERRAL_FEE]).toBe("0");
  });

  it("紹介元は表示中に空なら空文字（text の既定どおり・4-4 の表）", () => {
    const p = payloadFor({ introduction: "タイナビ", [REFERRAL_SOURCE]: "" });
    expect(p[REFERRAL_SOURCE]).toBe("");
  });

  it("紹介元は前後の空白を落として送る", () => {
    const p = payloadFor({
      introduction: "タイナビ",
      [REFERRAL_SOURCE]: "  A商事  ",
    });
    expect(p[REFERRAL_SOURCE]).toBe("A商事");
  });
});

describe("非表示時の既定値適用でも潰さない", () => {
  it("★ 導入経緯を対象外に変えても、画面の値が残る", () => {
    const before: CustomerInfoFormValues = {
      introduction: "ダイレクト",
      [REFERRAL_SOURCE]: "A商事",
      [REFERRAL_FEE]: "50,000",
    };
    const after = applyCustomerInfoHiddenDefaultsToValues(before);
    expect(after[REFERRAL_SOURCE]).toBe("A商事");
    expect(after[REFERRAL_FEE]).toBe("50,000");
  });

  it("工務店名は従来どおり - に揃う（この2項目だけの扱い）", () => {
    const after = applyCustomerInfoHiddenDefaultsToValues({
      introduction: "ダイレクト",
      builderOrTorachiName: "テスト工務店",
    });
    expect(after.builderOrTorachiName).toBe("-");
  });
});

describe("他の項目に影響していないこと", () => {
  it("★ 工務店名の表示条件は変えていない（条件B のまま）", () => {
    const shown = [
      "(DC)工務店OBリスト",
      "工務店トスアップ",
      "トラーチ倶楽部",
      "卸案件",
      "お客様紹介",
    ];
    for (const route of INTRODUCTION_ROUTE_OPTIONS) {
      expect(
        isCustomerInfoFormFieldVisible("builderOrTorachiName", {
          introduction: route,
        }),
        route,
      ).toBe(shown.includes(route));
    }
  });

  it("★ 導入経緯そのものは常に表示・選択肢13件のまま", () => {
    expect(isCustomerInfoFormFieldVisible("introduction", {})).toBe(true);
    expect(INTRODUCTION_ROUTE_OPTIONS).toHaveLength(13);
    expect(CUSTOMER_INFO_FORM_FIELD_MAP.get("introduction")?.options).toEqual([
      ...INTRODUCTION_ROUTE_OPTIONS,
    ]);
  });

  it("★ 条件W（非FIT の書類）は導入経緯に影響されない", () => {
    for (const route of INTRODUCTION_ROUTE_OPTIONS) {
      const base = { introduction: route, installationType: "太陽光パネル+蓄電池" };
      expect(
        isCustomerInfoFormFieldVisible("sealRegistrationCertificate", {
          ...base,
          fitType: "FIT",
        }),
        route,
      ).toBe(true);
      expect(
        isCustomerInfoFormFieldVisible("sealRegistrationCertificate", {
          ...base,
          fitType: "非FIT",
        }),
        route,
      ).toBe(false);
    }
  });
});
