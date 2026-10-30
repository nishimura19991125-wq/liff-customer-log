import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  customerInfoFieldUsesStaffNameCombobox,
  REFERRAL_SOURCE_COMBOBOX_PLACEHOLDER,
} from "@/lib/customer-info-form/combobox-fields";
import {
  referralSourceFieldPresentation,
  type ReferralSourceOptionsState,
} from "@/lib/customer-info-form/referral-source-options";
import {
  commitStaffNameInput,
  filterStaffNameSuggestions,
  isExactStaffName,
} from "@/lib/staff-name-options";

/**
 * 紹介元を、AP担当者と同じコンボボックス（StaffNameSuggestCombobox）にする。
 *
 * 部品には手を入れない。トラーチ倶楽部の案件で一覧を読めたときだけ
 * 部品を使い、それ以外はテキストのまま。
 *
 * 画面を描くテストの仕組みが無いので、部品が使う絞り込み・確定の関数
 * （staff-name-options.ts）に、紹介元の選択肢を渡して動きを確かめる。
 */

const CLUB = "トラーチ倶楽部";
const OPTIONS = ["アオイ工業", "カトウ商店", "カトウ電設", "ワタナベ電設"];
const READY: ReferralSourceOptionsState = { status: "ready", options: OPTIONS };
const clubAp = { apStaff: CLUB, clStaff: "担当B" };
const notClub = { apStaff: "担当A", clStaff: "担当B" };

/** 画面と同じ手順で、紹介元の欄（visibleFields の1件）を作る */
function referralField(
  values: { apStaff?: string; clStaff?: string; referralSource?: string },
  state: ReferralSourceOptionsState,
) {
  const p = referralSourceFieldPresentation(values, state);
  return {
    key: "referralSource",
    type: p.type,
    options: p.options,
    optionsPending: false,
  };
}

describe("★ トラーチ倶楽部のとき紹介元がコンボボックスになる", () => {
  for (const [label, staff] of [
    ["AP がトラーチ倶楽部", clubAp],
    ["CL がトラーチ倶楽部", { apStaff: "担当A", clStaff: CLUB }],
    ["両方トラーチ倶楽部", { apStaff: CLUB, clStaff: CLUB }],
  ] as const) {
    it(label, () => {
      expect(customerInfoFieldUsesStaffNameCombobox(referralField(staff, READY))).toBe(
        true,
      );
    });
  }

  it("部品の入力欄の案内（placeholder）は会社名向けに渡す", () => {
    expect(REFERRAL_SOURCE_COMBOBOX_PLACEHOLDER).toBe("会社名を入力または候補から選択");
  });
});

describe("★ それ以外のときはテキストのまま", () => {
  it("どちらもトラーチ倶楽部でなければ使わない", () => {
    const f = referralField({ ...notClub, referralSource: "A商事" }, READY);
    expect(f.type).toBe("text");
    expect(customerInfoFieldUsesStaffNameCombobox(f)).toBe(false);
  });
});

describe("★ 一覧が読めないときはテキストに戻る", () => {
  for (const state of [
    { status: "failed" },
    { status: "ready", options: [] },
    { status: "loading" },
    { status: "idle" },
  ] as ReferralSourceOptionsState[]) {
    it(`一覧の状態「${state.status}${state.status === "ready" ? "・0件" : ""}」`, () => {
      const f = referralField(clubAp, state);
      expect(f.type).toBe("text");
      expect(customerInfoFieldUsesStaffNameCombobox(f)).toBe(false);
    });
  }
});

describe("★ 入力すると候補が絞られる", () => {
  const options = referralField(clubAp, READY).options;

  it("入力した文字を含む会社だけが残る", () => {
    expect(filterStaffNameSuggestions(options, "カトウ")).toEqual([
      "カトウ商店",
      "カトウ電設",
    ]);
    expect(filterStaffNameSuggestions(options, "電設")).toEqual([
      "カトウ電設",
      "ワタナベ電設",
    ]);
  });

  it("未入力なら全部出る", () => {
    expect(filterStaffNameSuggestions(options, "")).toEqual(OPTIONS);
  });
});

describe("★ 候補を選べる", () => {
  const options = referralField(clubAp, READY).options;

  it("候補と同じ名前はそのまま確定する", () => {
    expect(commitStaffNameInput(options, "ワタナベ電設")).toBe("ワタナベ電設");
    expect(isExactStaffName(options, "ワタナベ電設")).toBe(true);
  });

  it("候補に無い値は先頭の候補に置き換えるか、空にする（部品の既定の動き）", () => {
    expect(commitStaffNameInput(options, "カトウ")).toBe("カトウ商店");
    expect(commitStaffNameInput(options, "存在しない会社")).toBe("");
  });
});

describe("★ 一覧に無い既存の値", () => {
  const values = { ...clubAp, referralSource: "イシダ設備" };
  const options = referralField(values, READY).options;

  it("選択肢に出る", () => {
    expect(options).toContain("イシダ設備");
    expect(filterStaffNameSuggestions(options, "イシダ")).toEqual(["イシダ設備"]);
  });

  it("開いて確定・保存しても置き換わらない（赤枠にもならない）", () => {
    expect(isExactStaffName(options, values.referralSource)).toBe(true);
    expect(commitStaffNameInput(options, values.referralSource)).toBe("イシダ設備");
  });
});

describe("★ AP担当者・CL担当者は今までどおりコンボボックス", () => {
  for (const key of ["apStaff", "clStaff"]) {
    it(`${key}：一覧の状態に関係なく使う`, () => {
      for (const field of [
        { key, type: "select", options: ["山田"], optionsPending: false },
        { key, type: "select", options: [], optionsPending: true },
        { key, type: "select", options: [], optionsPending: false },
      ]) {
        expect(customerInfoFieldUsesStaffNameCombobox(field)).toBe(true);
      }
    });
  }

  it("ほかの選択式の項目には使わない", () => {
    for (const key of ["creditCompany", "constructionContractor", "manufacturer"]) {
      expect(
        customerInfoFieldUsesStaffNameCombobox({
          key,
          type: "select",
          options: ["A"],
          optionsPending: false,
        }),
      ).toBe(false);
    }
  });
});

describe("★ 部品そのものは変わっていない", () => {
  /**
   * コンボボックスの部品・絞り込みの関数・工事対応者の選択（4画面で使う）の
   * 中身を固定する。改行コードの違いは無視する。
   *
   * ⚠ ここが落ちたら、紹介元のために部品を直していないかを疑うこと。
   *   部品を変える必要があるなら、AP担当者・CL担当者・工事対応者への影響を
   *   確かめたうえで、別の依頼として扱う。
   */
  const FIXED = {
    "src/components/staff-name-suggest-combobox.tsx":
      "6e14f7498c8a13d29cbd55ba541303f1eeb1321de2806a02473059f08d866bea",
    "src/lib/staff-name-options.ts":
      "822119b8b47f0194a564ef5480eff9f30512c372700bcfb346c2970213f506c0",
    "src/components/construction-handler-staff-select.tsx":
      "c1d66bf682a34a2a72dc93ab31ddefe0bedbd50d790a737e018ea606e35b5f35",
  };

  for (const [file, hash] of Object.entries(FIXED)) {
    it(file, () => {
      const src = readFileSync(join(process.cwd(), file), "utf8").replace(/\r\n/g, "\n");
      expect(createHash("sha256").update(src).digest("hex")).toBe(hash);
    });
  }

  it("部品の文言（候補に無いときの赤字）は部品の中に固定で書かれている", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/staff-name-suggest-combobox.tsx"),
      "utf8",
    );
    expect(src).toContain("スタッフ名を候補から選んでください");
  });
});
