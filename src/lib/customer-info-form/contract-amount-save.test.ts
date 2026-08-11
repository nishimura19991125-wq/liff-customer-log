import { describe, expect, it } from "vitest";

import {
  applyCustomerInfoFormChange,
  syncContractAmountFromPayment,
} from "@/lib/customer-info-form/form-change";
import { buildCustomerInfoFormPayload } from "@/lib/customer-info-form/rules";
import { CUSTOMER_INFO_FORM_FIELDS } from "@/lib/customer-info-form/schema";
import type {
  CustomerInfoFormFieldResolved,
  CustomerInfoFormValues,
} from "@/lib/customer-info-form/types";

/** fieldId にキーをそのまま使い、payload を読みやすくする */
const RESOLVED: CustomerInfoFormFieldResolved[] = CUSTOMER_INFO_FORM_FIELDS.map(
  (f) => ({ ...f, fieldId: f.liffOnly ? "" : f.key, label: f.caption, value: "" }),
);

function payloadFor(values: CustomerInfoFormValues): Record<string, unknown> {
  return buildCustomerInfoFormPayload(values, RESOLVED);
}

const BASE: CustomerInfoFormValues = {
  installationType: "太陽光パネル+蓄電池",
  panelCombo: "無",
};

/**
 * 契約金額は現金+ローンから引き直して保存する。
 *
 * 入力欄は連動する支払方法のとき disabled で、画面には常に計算結果が出る。
 * 保存も同じ計算を通すことで **画面の表示と保存される値を一致させる**。
 * @pocket 側でも両者は一致する運用のため、ずれることは起こりえない。
 */
describe("契約金額は自動計算値で保存する", () => {
  it("★ 現金一括: 現金の額で保存される", () => {
    const p = payloadFor({
      ...BASE,
      paymentMethod: "現金一括",
      cashAmount: "1,000,000",
      // 画面は disabled なのでここに別の値が入ることは通常ない
      contractAmount: "1,234,567",
    });
    expect(p.contractAmount).toBe("1000000");
  });

  it("★ 頭金+ソーラーローン: 現金+ローンの合計で保存される", () => {
    const p = payloadFor({
      ...BASE,
      paymentMethod: "頭金+ソーラーローン",
      cashAmount: "500,000",
      loanAmount: "1,500,000",
      contractAmount: "1,900,000",
    });
    expect(p.contractAmount).toBe("2000000");
  });

  it("★ ソーラーローン: ローンの額で保存される", () => {
    const p = payloadFor({
      ...BASE,
      paymentMethod: "ソーラーローン",
      loanAmount: "2,000,000",
      contractAmount: "1,800,000",
    });
    expect(p.contractAmount).toBe("2000000");
  });

  it("★ 画面の表示値と保存値が一致する", () => {
    const values: CustomerInfoFormValues = {
      ...BASE,
      paymentMethod: "頭金+ソーラーローン",
      cashAmount: "500,000",
      loanAmount: "1,500,000",
      contractAmount: "1,900,000",
    };
    // 画面（displayValues）が出す値
    const shown = syncContractAmountFromPayment(values).contractAmount ?? "";
    // 保存される値（カンマなし）
    const saved = String(payloadFor(values).contractAmount ?? "");
    expect(shown).toBe("2,000,000");
    expect(saved).toBe(shown.replace(/,/g, ""));
  });

  it("連動しない支払方法（住宅ローン組込）なら入力値をそのまま保存する", () => {
    const p = payloadFor({
      ...BASE,
      paymentMethod: "住宅ローン組込",
      contractAmount: "1,234,567",
    });
    expect(p.contractAmount).toBe("1234567");
  });

  it("契約金額が空なら - が書かれる（未入力時の扱い）", () => {
    const p = payloadFor({
      ...BASE,
      paymentMethod: "住宅ローン組込",
      contractAmount: "",
    });
    expect(p.contractAmount).toBe("-");
  });

  it("カンマは外して書き込む", () => {
    const p = payloadFor({ ...BASE, contractAmount: "3,000,000" });
    expect(p.contractAmount).toBe("3000000");
  });
});

describe("画面上の自動計算", () => {
  it("支払方法を変えると契約金額が入る", () => {
    const next = applyCustomerInfoFormChange(
      { ...BASE, cashAmount: "1,000,000", contractAmount: "" },
      "paymentMethod",
      "現金一括",
    );
    expect(next.contractAmount).toBe("1,000,000");
  });

  it("現金・ローンを変えると契約金額が追随する", () => {
    const afterCash = applyCustomerInfoFormChange(
      { ...BASE, paymentMethod: "頭金+ソーラーローン", loanAmount: "1,500,000" },
      "cashAmount",
      "500,000",
    );
    expect(afterCash.contractAmount).toBe("2,000,000");
  });

  it("連動しない支払方法（住宅ローン組込）なら契約金額を直接入力できる", () => {
    const next = applyCustomerInfoFormChange(
      { ...BASE, paymentMethod: "住宅ローン組込", contractAmount: "" },
      "contractAmount",
      "1,234,567",
    );
    expect(next.contractAmount).toBe("1,234,567");
  });

  it("連動そのものの計算は変えていない", () => {
    expect(
      syncContractAmountFromPayment({
        ...BASE,
        paymentMethod: "頭金+ソーラーローン",
        cashAmount: "500,000",
        loanAmount: "1,500,000",
        contractAmount: "",
      }).contractAmount,
    ).toBe("2,000,000");
  });
});
