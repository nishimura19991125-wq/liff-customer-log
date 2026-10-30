import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  REFERRAL_SOURCE_OPTIONS_FAILED_NOTE,
  REFERRAL_SOURCE_OPTIONS_LOADING_NOTE,
  referralSourceFieldPresentation,
  referralSourceOptionsStateFromResponse,
  type ReferralSourceOptionsState,
} from "@/lib/customer-info-form/referral-source-options";
import {
  buildCustomerInfoFormPayload,
} from "@/lib/customer-info-form/rules";
import {
  CUSTOMER_INFO_FORM_FIELDS,
  CUSTOMER_INFO_FORM_FIELD_MAP,
} from "@/lib/customer-info-form/schema";
import type {
  CustomerInfoFormFieldResolved,
  CustomerInfoFormValues,
} from "@/lib/customer-info-form/types";
import { findMissingRequiredCustomerInfoFields } from "@/lib/customer-info-form/validate";

/**
 * 紹介元を、トラーチ倶楽部の案件だけ取引先会社一覧（トラーチ倶楽部加盟店）から
 * 選ぶ単一選択にする。それ以外・一覧が読めないときはテキストのまま。
 */

const CLUB = "トラーチ倶楽部";
const OPTIONS = ["アオイ工業", "カトウ商店", "ワタナベ電設"];
const READY: ReferralSourceOptionsState = { status: "ready", options: OPTIONS };
const FAILED: ReferralSourceOptionsState = { status: "failed" };
const LOADING: ReferralSourceOptionsState = { status: "loading" };
const IDLE: ReferralSourceOptionsState = { status: "idle" };

const clubAp = { apStaff: CLUB, clStaff: "担当B" };
const clubCl = { apStaff: "担当A", clStaff: CLUB };
const notClub = { apStaff: "担当A", clStaff: "担当B" };

describe("★ トラーチ倶楽部のとき紹介元が選択式になる", () => {
  for (const [label, staff] of [
    ["AP がトラーチ倶楽部", clubAp],
    ["CL がトラーチ倶楽部", clubCl],
    ["両方トラーチ倶楽部", { apStaff: CLUB, clStaff: CLUB }],
  ] as const) {
    it(label, () => {
      const p = referralSourceFieldPresentation(staff, READY);
      expect(p.type).toBe("select");
      expect(p.options).toEqual(OPTIONS);
      expect(p.note).toBeNull();
    });
  }
});

describe("★ それ以外のときはテキストのまま", () => {
  for (const state of [READY, FAILED, LOADING, IDLE]) {
    it(`一覧の状態「${state.status}」でもテキスト・説明なし`, () => {
      const p = referralSourceFieldPresentation(
        { ...notClub, referralSource: "A商事" },
        state,
      );
      expect(p.type).toBe("text");
      expect(p.note).toBeNull();
    });
  }

  it("担当者が空でもテキスト", () => {
    expect(referralSourceFieldPresentation({}, READY).type).toBe("text");
  });
});

describe("★ 一覧に無い既存の値は選択肢に足す", () => {
  it("足したうえで五十音順に並べ直す", () => {
    const p = referralSourceFieldPresentation(
      { ...clubAp, referralSource: "イシダ設備" },
      READY,
    );
    expect(p.type).toBe("select");
    expect(p.options).toEqual(["アオイ工業", "イシダ設備", "カトウ商店", "ワタナベ電設"]);
  });

  it("一覧にある値なら重ねない", () => {
    const p = referralSourceFieldPresentation(
      { ...clubAp, referralSource: "カトウ商店" },
      READY,
    );
    expect(p.options).toEqual(OPTIONS);
  });

  it("空なら何も足さない", () => {
    const p = referralSourceFieldPresentation({ ...clubAp, referralSource: "" }, READY);
    expect(p.options).toEqual(OPTIONS);
  });

  it("元の一覧を書き換えない", () => {
    const options = [...OPTIONS];
    referralSourceFieldPresentation(
      { ...clubAp, referralSource: "イシダ設備" },
      { status: "ready", options },
    );
    expect(options).toEqual(OPTIONS);
  });
});

describe("★ 一覧が読めないときはテキスト入力に戻し、説明を出す", () => {
  it("読み込みに失敗したとき", () => {
    const p = referralSourceFieldPresentation(clubAp, FAILED);
    expect(p.type).toBe("text");
    expect(p.note).toBe(REFERRAL_SOURCE_OPTIONS_FAILED_NOTE);
  });

  it("一覧が0件のとき（選べるものが無い）", () => {
    const p = referralSourceFieldPresentation(clubAp, { status: "ready", options: [] });
    expect(p.type).toBe("text");
    expect(p.note).toBe(REFERRAL_SOURCE_OPTIONS_FAILED_NOTE);
  });

  it("説明の文言は手入力を促し、内部の事情を出さない", () => {
    expect(REFERRAL_SOURCE_OPTIONS_FAILED_NOTE).toBe(
      "選択肢を読み込めませんでした。手入力してください。",
    );
    expect(REFERRAL_SOURCE_OPTIONS_FAILED_NOTE).not.toMatch(/field-|アプリ|ID|11/);
  });

  it("読み込み中はテキストのまま待つ（入力は止めない）", () => {
    for (const state of [LOADING, IDLE]) {
      const p = referralSourceFieldPresentation(clubAp, state);
      expect(p.type).toBe("text");
      expect(p.note).toBe(REFERRAL_SOURCE_OPTIONS_LOADING_NOTE);
    }
  });
});

describe("API の応答から一覧の状態を決める", () => {
  it("取得できれば ready", () => {
    expect(
      referralSourceOptionsStateFromResponse(true, { options: OPTIONS, configured: true }),
    ).toEqual({ status: "ready", options: OPTIONS });
  });

  it("★ エラー応答・未設定・形が違うときは failed（テキストに戻る）", () => {
    expect(referralSourceOptionsStateFromResponse(false, { error: "x" })).toEqual(FAILED);
    expect(
      referralSourceOptionsStateFromResponse(true, { options: [], configured: false }),
    ).toEqual(FAILED);
    expect(referralSourceOptionsStateFromResponse(true, null)).toEqual(FAILED);
    expect(referralSourceOptionsStateFromResponse(true, { options: "x" })).toEqual(FAILED);
  });

  it("文字列以外・空の要素は落とす", () => {
    expect(
      referralSourceOptionsStateFromResponse(true, {
        options: ["アオイ工業", "", 3, null],
        configured: true,
      }),
    ).toEqual({ status: "ready", options: ["アオイ工業"] });
  });
});

describe("★ 担当者を変えても値は消えない", () => {
  const RESOLVED: CustomerInfoFormFieldResolved[] = CUSTOMER_INFO_FORM_FIELDS.map(
    (f) => ({ ...f, fieldId: f.liffOnly ? "" : f.key, label: f.caption, value: "" }),
  );

  it("欄の形は切り替わるが、値には触らない", () => {
    const values: CustomerInfoFormValues = Object.freeze({
      ...clubAp,
      introduction: "お客様紹介",
      referralSource: "イシダ設備",
    });
    const before = referralSourceFieldPresentation(values, READY);
    const changed: CustomerInfoFormValues = { ...values, apStaff: "担当A" };
    const after = referralSourceFieldPresentation(changed, READY);

    expect(before.type).toBe("select");
    expect(after.type).toBe("text");
    // 値は欄の形と関係なくそのまま保存される
    expect(changed.referralSource).toBe("イシダ設備");
    expect(buildCustomerInfoFormPayload(values, RESOLVED).referralSource).toBe("イシダ設備");
    expect(buildCustomerInfoFormPayload(changed, RESOLVED).referralSource).toBe("イシダ設備");
  });
});

describe("★ 空なら拒否する動きは変わらない", () => {
  it("選択式になっても、空なら必須の未入力になる", () => {
    const def = CUSTOMER_INFO_FORM_FIELD_MAP.get("referralSource")!;
    const field = { key: def.key, label: def.caption, type: def.type, required: def.required };
    expect(
      findMissingRequiredCustomerInfoFields([field], { ...clubAp, referralSource: "" }).map(
        (f) => f.key,
      ),
    ).toEqual(["referralSource"]);
    // schema 上はテキストのまま（保存・検証の型は変えない）
    expect(def.type).toBe("text");
  });
});

describe("判定は isReferralSourceRequiredByClub を使う", () => {
  it("★ 新しく名前の比較を書いていない", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/customer-info-form/referral-source-options.ts"),
      "utf8",
    );
    expect(src).toContain("isReferralSourceRequiredByClub(");
    const code = src
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");
    expect(code).not.toMatch(/トラーチ|isClubStaffName|normApClStaffName/);
  });
});
