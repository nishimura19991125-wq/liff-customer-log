import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CLUB_CONSTRUCTION_HANDLER_NAME,
  isClubApClPair,
  isClubStaffName,
} from "@/lib/customer-info-club-construction-handler";
import {
  INTRODUCTION_ROUTE_OPTIONS,
  isReferralSourceRequiredByClub,
  REFERRAL_SOURCE_CLUB_REQUIRED_HINT,
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
import type {
  CustomerInfoFormFieldResolved,
  CustomerInfoFormValues,
} from "@/lib/customer-info-form/types";
import {
  findMissingRequiredCustomerInfoFields,
  isCustomerInfoFieldRequired,
} from "@/lib/customer-info-form/validate";

/**
 * トラーチ倶楽部の案件で紹介元を必須にする。
 *
 * 条件：AP担当者 **または** CL担当者 がトラーチ倶楽部。
 * そのときは導入経緯（条件A）に関係なく紹介元を表示し、必須にする。
 * 紹介手数料は条件A のまま変えない。
 */

const CLUB = CLUB_CONSTRUCTION_HANDLER_NAME;
const REFERRAL_SOURCE = "referralSource";
const REFERRAL_FEE = "referralFee";
/** 条件A の対象外（紹介元が通常は隠れる）導入経緯 */
const HIDDEN_ROUTE = "ダイレクト";
/** 条件A の対象（紹介元が通常でも出る）導入経緯 */
const SHOWN_ROUTE = "お客様紹介";

const RESOLVED: CustomerInfoFormFieldResolved[] = CUSTOMER_INFO_FORM_FIELDS.map(
  (f) => ({
    ...f,
    fieldId: f.liffOnly ? "" : f.key,
    label: f.caption,
    value: "",
  }),
);

function payloadFor(values: CustomerInfoFormValues): Record<string, unknown> {
  return buildCustomerInfoFormPayload(values, RESOLVED);
}

function validateField(key: string) {
  const def = CUSTOMER_INFO_FORM_FIELD_MAP.get(key);
  if (!def) throw new Error(`schema に無いキー: ${key}`);
  return { key: def.key, label: def.caption, type: def.type, required: def.required };
}

function missingReferral(values: CustomerInfoFormValues): string[] {
  return findMissingRequiredCustomerInfoFields(
    [validateField(REFERRAL_SOURCE)],
    values,
  ).map((f) => f.key);
}

/** 担当者の組み合わせ（AP / CL） */
const STAFF_CASES = [
  { label: "AP だけトラーチ倶楽部", apStaff: CLUB, clStaff: "担当B", club: true },
  { label: "CL だけトラーチ倶楽部", apStaff: "担当A", clStaff: CLUB, club: true },
  { label: "両方トラーチ倶楽部", apStaff: CLUB, clStaff: CLUB, club: true },
  { label: "どちらも別の人", apStaff: "担当A", clStaff: "担当B", club: false },
  { label: "どちらも空", apStaff: "", clStaff: "", club: false },
] as const;

describe("判定：AP または CL がトラーチ倶楽部なら必須", () => {
  for (const c of STAFF_CASES) {
    it(`★ ${c.label} → ${c.club ? "必須" : "必須でない"}`, () => {
      expect(
        isReferralSourceRequiredByClub({ apStaff: c.apStaff, clStaff: c.clStaff }),
      ).toBe(c.club);
    });
  }

  it("担当者が未設定（キーが無い）なら必須でない", () => {
    expect(isReferralSourceRequiredByClub({})).toBe(false);
  });
});

describe("判定は工事対応者の自動入力と同じものを使う", () => {
  /** 表記ゆれを含む名前。既存の正規化（NFKC・空白）で同じ扱いになるか */
  const NAMES = [
    CLUB,
    ` ${CLUB} `,
    "ﾄﾗｰﾁ倶楽部",
    "トラーチ　倶楽部",
    "トラーチ倶楽部A",
    "トラーチ",
    "担当A",
    "",
  ];

  it("★ 両方トラーチ倶楽部の判定（isClubApClPair）は1人分の判定の AND", () => {
    for (const ap of NAMES) {
      for (const cl of NAMES) {
        expect(isClubApClPair(ap, cl), `${ap} / ${cl}`).toBe(
          isClubStaffName(ap) && isClubStaffName(cl),
        );
      }
    }
  });

  it("★ 紹介元の判定は同じ1人分の判定の OR", () => {
    for (const ap of NAMES) {
      for (const cl of NAMES) {
        expect(
          isReferralSourceRequiredByClub({ apStaff: ap, clStaff: cl }),
          `${ap} / ${cl}`,
        ).toBe(isClubStaffName(ap) || isClubStaffName(cl));
      }
    }
  });

  it("★ 両方トラーチ倶楽部の案件は、紹介元の判定でも必ず必須になる", () => {
    for (const ap of NAMES) {
      for (const cl of NAMES) {
        if (!isClubApClPair(ap, cl)) continue;
        expect(
          isReferralSourceRequiredByClub({ apStaff: ap, clStaff: cl }),
          `${ap} / ${cl}`,
        ).toBe(true);
      }
    }
  });

  it("★ options.ts にトラーチ倶楽部の文字列を書いていない（判定を新しく書かない）", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/customer-info-form/options.ts"),
      "utf8",
    );
    // 1人分の判定（isClubStaffName）を使い、名前の比較を自前で書かない
    expect(src).toMatch(
      /import \{ isClubStaffName \} from "@\/lib\/customer-info-club-construction-handler"/,
    );
    const code = src
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");
    expect(code).not.toMatch(/normApClStaffName|CLUB_CONSTRUCTION_HANDLER_NAME/);
    expect(code).not.toMatch(/(===|!==|includes\(|startsWith\(|has\()\s*"トラーチ/);
  });
});

describe("表示：トラーチ倶楽部なら導入経緯に関係なく紹介元を出す", () => {
  it("★ 条件A の対象外でも、AP がトラーチ倶楽部なら紹介元が出る", () => {
    const values = { introduction: HIDDEN_ROUTE, apStaff: CLUB, clStaff: "担当B" };
    expect(isCustomerInfoFormFieldVisible(REFERRAL_SOURCE, values)).toBe(true);
  });

  it("★ 紹介手数料は条件A のまま（トラーチ倶楽部でも出ない）", () => {
    const values = { introduction: HIDDEN_ROUTE, apStaff: CLUB, clStaff: CLUB };
    expect(isCustomerInfoFormFieldVisible(REFERRAL_FEE, values)).toBe(false);
  });

  it("どちらもトラーチ倶楽部でなければ、従来どおり条件A で決まる", () => {
    const base = { apStaff: "担当A", clStaff: "担当B" };
    expect(
      isCustomerInfoFormFieldVisible(REFERRAL_SOURCE, { ...base, introduction: HIDDEN_ROUTE }),
    ).toBe(false);
    expect(
      isCustomerInfoFormFieldVisible(REFERRAL_SOURCE, { ...base, introduction: SHOWN_ROUTE }),
    ).toBe(true);
  });
});

describe("必須", () => {
  for (const c of STAFF_CASES) {
    for (const route of [HIDDEN_ROUTE, SHOWN_ROUTE, ""]) {
      it(`★ ${c.label}・導入経緯「${route || "未選択"}」・紹介元が空`, () => {
        const values = {
          introduction: route,
          apStaff: c.apStaff,
          clStaff: c.clStaff,
          [REFERRAL_SOURCE]: "",
        };
        expect(
          isCustomerInfoFieldRequired(validateField(REFERRAL_SOURCE), values),
        ).toBe(c.club);
        expect(missingReferral(values)).toEqual(c.club ? [REFERRAL_SOURCE] : []);
      });
    }
  }

  it("★ 紹介元が入っていれば必須を満たす", () => {
    expect(
      missingReferral({ introduction: HIDDEN_ROUTE, apStaff: CLUB, [REFERRAL_SOURCE]: "A商事" }),
    ).toEqual([]);
  });

  it("空白や「-」だけは未入力扱い", () => {
    for (const raw of ["   ", "-"]) {
      expect(
        missingReferral({ apStaff: CLUB, [REFERRAL_SOURCE]: raw }),
        JSON.stringify(raw),
      ).toEqual([REFERRAL_SOURCE]);
    }
  });

  it("キャンセル案件は他の項目と同じく必須を外す", () => {
    expect(
      missingReferral({
        apStaff: CLUB,
        customerStatus: "キャンセル",
        [REFERRAL_SOURCE]: "",
      }),
    ).toEqual([]);
  });

  it("schema 上は任意のまま（必須は担当者で決まる）", () => {
    expect(CUSTOMER_INFO_FORM_FIELD_MAP.get(REFERRAL_SOURCE)?.required).toBe(false);
  });

  it("画面に出す理由の文言は担当者の条件が分かる", () => {
    expect(REFERRAL_SOURCE_CLUB_REQUIRED_HINT).toContain("トラーチ倶楽部");
    expect(REFERRAL_SOURCE_CLUB_REQUIRED_HINT).toContain("AP担当者");
    expect(REFERRAL_SOURCE_CLUB_REQUIRED_HINT).toContain("CL担当者");
    expect(REFERRAL_SOURCE_CLUB_REQUIRED_HINT).not.toMatch(/field-/);
  });
});

describe("保存：トラーチ倶楽部の案件では紹介元を送る", () => {
  it("★ 条件A の対象外でも紹介元を送る（紹介手数料は送らない）", () => {
    const p = payloadFor({
      introduction: HIDDEN_ROUTE,
      apStaff: CLUB,
      clStaff: "担当B",
      [REFERRAL_SOURCE]: "  A商事 ",
      [REFERRAL_FEE]: "50,000",
    });
    expect(p[REFERRAL_SOURCE]).toBe("A商事");
    expect(p).not.toHaveProperty(REFERRAL_FEE);
  });
});

describe("担当者を変えたとき", () => {
  const clubValues: CustomerInfoFormValues = {
    introduction: HIDDEN_ROUTE,
    apStaff: CLUB,
    clStaff: "担当B",
    [REFERRAL_SOURCE]: "A商事",
  };
  const changed: CustomerInfoFormValues = { ...clubValues, apStaff: "担当A" };

  it("★ トラーチ倶楽部以外に変えても、画面の紹介元は消えない", () => {
    const after = applyCustomerInfoHiddenDefaultsToValues(changed);
    expect(after[REFERRAL_SOURCE]).toBe("A商事");
  });

  it("★ トラーチ倶楽部以外に変えて保存しても、紹介元を空や「-」で上書きしない", () => {
    const p = payloadFor(changed);
    expect(p).not.toHaveProperty(REFERRAL_SOURCE);
  });

  it("★ 条件A の対象なら、変えたあとも紹介元はそのまま送る", () => {
    const p = payloadFor({ ...changed, introduction: SHOWN_ROUTE });
    expect(p[REFERRAL_SOURCE]).toBe("A商事");
  });

  it("★ 条件から外れたら必須でなくなる", () => {
    const empty = { ...changed, [REFERRAL_SOURCE]: "" };
    expect(missingReferral(empty)).toEqual([]);
    expect(missingReferral({ ...empty, introduction: SHOWN_ROUTE })).toEqual([]);
    // 変える前は必須だった
    expect(missingReferral({ ...clubValues, [REFERRAL_SOURCE]: "" })).toEqual([
      REFERRAL_SOURCE,
    ]);
  });
});

/**
 * 紹介元と紹介手数料で「違ってよい箇所」。
 *
 * 2項目はもともと条件A（導入経緯）だけで同じように動いていた。
 * トラーチ倶楽部の条件は紹介元だけに掛けたので、表示がずれるのは
 * 「トラーチ倶楽部 かつ 条件A の対象外」のときだけ。
 *
 * ⚠ **2つ目の差を足すときは、必ずこの一覧にも足すこと。**
 *   件数をテストで固定してあり、下の総当たりも一覧に挙げた分だけを
 *   比較から外している。一覧に無い差が生まれれば総当たりが落ちる。
 */
const ALLOWED_REFERRAL_DIFFERENCES = [
  {
    id: "clubReferralSource",
    label: "AP/CL がトラーチ倶楽部なら、条件A の対象外でも紹介元だけ表示・必須",
    since: "トラーチ倶楽部の案件で紹介元を必須にする",
  },
] as const;

describe("紹介元と紹介手数料で違ってよい箇所", () => {
  it("★ 違ってよいのは1箇所だけ（トラーチ倶楽部の紹介元）", () => {
    expect(ALLOWED_REFERRAL_DIFFERENCES.map((d) => d.id)).toEqual([
      "clubReferralSource",
    ]);
  });

  it("★ 表示がずれるのはトラーチ倶楽部かつ条件A の対象外のときだけ", () => {
    for (const route of [...INTRODUCTION_ROUTE_OPTIONS, ""]) {
      for (const c of STAFF_CASES) {
        const values = { introduction: route, apStaff: c.apStaff, clStaff: c.clStaff };
        const src = isCustomerInfoFormFieldVisible(REFERRAL_SOURCE, values);
        const fee = isCustomerInfoFormFieldVisible(REFERRAL_FEE, values);
        const allowed = c.club && !shouldShowReferralSourceFields(values);
        const label = `${route || "未選択"} / ${c.label}`;
        if (allowed) {
          expect(src, label).toBe(true);
          expect(fee, label).toBe(false);
        } else {
          expect(src, label).toBe(fee);
        }
      }
    }
  });
});
