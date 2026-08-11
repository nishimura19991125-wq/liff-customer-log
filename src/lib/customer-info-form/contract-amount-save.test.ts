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

describe("M-3: 保存時に契約金額を再計算しない", () => {
  it("★ 手入力した契約金額がそのまま保存される", () => {
    const p = payloadFor({
      ...BASE,
      paymentMethod: "現金一括",
      cashAmount: "1,000,000",
      contractAmount: "1,234,567",
    });
    // 以前は現金（1000000）で上書きされていた
    expect(p.contractAmount).toBe("1234567");
  });

  it("★ 頭金+ソーラーローンでも、入っている契約金額を書き換えない", () => {
    const p = payloadFor({
      ...BASE,
      paymentMethod: "頭金+ソーラーローン",
      cashAmount: "500,000",
      loanAmount: "1,500,000",
      contractAmount: "1,900,000",
    });
    expect(p.contractAmount).toBe("1900000");
  });

  it("★ ソーラーローンでも書き換えない", () => {
    const p = payloadFor({
      ...BASE,
      paymentMethod: "ソーラーローン",
      loanAmount: "2,000,000",
      contractAmount: "1,800,000",
    });
    expect(p.contractAmount).toBe("1800000");
  });

  it("契約金額が空なら - が書かれる（従来の未入力時の扱い）", () => {
    const p = payloadFor({
      ...BASE,
      paymentMethod: "現金一括",
      cashAmount: "1,000,000",
      contractAmount: "",
    });
    expect(p.contractAmount).toBe("-");
  });

  it("カンマは外して書き込む（従来どおり）", () => {
    const p = payloadFor({ ...BASE, contractAmount: "3,000,000" });
    expect(p.contractAmount).toBe("3000000");
  });
});

describe("M-3: 画面上の自動計算は維持する", () => {
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

  it("★ 契約金額そのものを直したら、その値が残る（連動で戻さない）", () => {
    const next = applyCustomerInfoFormChange(
      {
        ...BASE,
        paymentMethod: "現金一括",
        cashAmount: "1,000,000",
        contractAmount: "1,000,000",
      },
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
