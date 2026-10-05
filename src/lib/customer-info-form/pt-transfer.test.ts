import { describe, expect, it } from "vitest";

import { computePtTransfer } from "@/lib/customer-info-form/pt-transfer";
import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";

/**
 * PT から APPT・CLPT への転記。
 *
 * 以前は AP担当者と CL担当者が同一のとき CLPT に全量・APPT に 0 を書いていた。
 * いまは**同一でも別人でも折半**する。集計側（sales-dashboard-customer-pt）は
 * 同一人物の APPT と CLPT を足すので、合計は変わらない。
 *
 * キャンセル時に両方を 0 で上書きする挙動は、保存経路を通して
 * customer-cancel.test.ts が固定している（ここは計算だけを見る）。
 */

function transfer(values: Partial<CustomerInfoFormValues>) {
  return computePtTransfer(values as CustomerInfoFormValues);
}

const AP = "営業 一郎";
const CL = "営業 二郎";

describe("★ 同一担当でも折半する", () => {
  it("★ AP と CL が同じ人でも APPT・CLPT に半分ずつ入る", () => {
    expect(transfer({ pt: "1200", apStaff: AP, clStaff: AP })).toEqual({
      appt: "600",
      clpt: "600",
    });
  });

  it("★ CLPT に全量・APPT に 0 の形には戻らない", () => {
    const res = transfer({ pt: "12000", apStaff: AP, clStaff: AP });

    expect(res.appt).not.toBe("0");
    expect(res.clpt).not.toBe("12000");
  });

  it("★ 同一担当と別人で結果が同じ", () => {
    expect(transfer({ pt: "1200", apStaff: AP, clStaff: AP })).toEqual(
      transfer({ pt: "1200", apStaff: AP, clStaff: CL }),
    );
  });

  it("全角半角・空白のゆれで同一と判定される組み合わせでも折半", () => {
    expect(
      transfer({ pt: "1200", apStaff: "営業　一郎", clStaff: " 営業 一郎 " }),
    ).toEqual({ appt: "600", clpt: "600" });
  });
});

describe("別人のときの挙動は変えていない", () => {
  it("PT÷2 を APPT・CLPT にそれぞれ入れる", () => {
    expect(transfer({ pt: "1200", apStaff: AP, clStaff: CL })).toEqual({
      appt: "600",
      clpt: "600",
    });
  });

  it("カンマ・全角数字は正規化してから割る", () => {
    expect(transfer({ pt: "1,200", apStaff: AP, clStaff: CL })).toEqual({
      appt: "600",
      clpt: "600",
    });
    expect(transfer({ pt: "１２００", apStaff: AP, clStaff: CL })).toEqual({
      appt: "600",
      clpt: "600",
    });
  });
});

describe("★ 奇数の PT は切り捨てる", () => {
  it("★ 1001 → 500 / 500（別人）", () => {
    expect(transfer({ pt: "1001", apStaff: AP, clStaff: CL })).toEqual({
      appt: "500",
      clpt: "500",
    });
  });

  it("★ 1001 → 500 / 500（同一担当でも同じ。合計が 1 減るのは許容）", () => {
    expect(transfer({ pt: "1001", apStaff: AP, clStaff: AP })).toEqual({
      appt: "500",
      clpt: "500",
    });
  });

  it("1 → 0 / 0", () => {
    expect(transfer({ pt: "1", apStaff: AP, clStaff: CL })).toEqual({
      appt: "0",
      clpt: "0",
    });
  });
});

describe("★ AP・CL のどちらかが空欄でも折半する", () => {
  it("AP担当者が空欄", () => {
    expect(transfer({ pt: "1200", apStaff: "", clStaff: CL })).toEqual({
      appt: "600",
      clpt: "600",
    });
  });

  it("CL担当者が空欄", () => {
    expect(transfer({ pt: "1200", apStaff: AP, clStaff: "" })).toEqual({
      appt: "600",
      clpt: "600",
    });
  });

  it("両方とも空欄・未設定", () => {
    expect(transfer({ pt: "1200", apStaff: "", clStaff: "" })).toEqual({
      appt: "600",
      clpt: "600",
    });
    expect(transfer({ pt: "1200" })).toEqual({ appt: "600", clpt: "600" });
  });
});

describe("★ PT が未入力のときは値を入れない", () => {
  /*
   * 従来どおり、両方とも "-"（@pocket の未入力の表記）を返す。
   * 数値は入れない。担当者が同一かどうかにもよらない。
   */
  it("★ 空文字なら両方とも「-」", () => {
    expect(transfer({ pt: "", apStaff: AP, clStaff: CL })).toEqual({
      appt: "-",
      clpt: "-",
    });
  });

  it("同一担当でも「-」", () => {
    expect(transfer({ pt: "", apStaff: AP, clStaff: AP })).toEqual({
      appt: "-",
      clpt: "-",
    });
  });

  it("数字を含まない入力・未設定でも「-」", () => {
    expect(transfer({ pt: "-", apStaff: AP, clStaff: CL })).toEqual({
      appt: "-",
      clpt: "-",
    });
    expect(transfer({ apStaff: AP, clStaff: CL })).toEqual({
      appt: "-",
      clpt: "-",
    });
  });

  it("0 は未入力ではない（0 / 0 を入れる）", () => {
    expect(transfer({ pt: "0", apStaff: AP, clStaff: CL })).toEqual({
      appt: "0",
      clpt: "0",
    });
  });
});
