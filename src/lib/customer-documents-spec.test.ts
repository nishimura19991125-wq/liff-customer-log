import { describe, expect, it } from "vitest";

import {
  CUSTOMER_DOCUMENT_KEYS,
  CUSTOMER_DOCUMENT_SPECS,
  customerDocumentSpecByKey,
  isCustomerDocumentKey,
} from "@/lib/customer-documents-spec";

/**
 * 完了値は項目ごとに違う。一律で「回収済み」を書くと @pocket のラジオ選択肢に
 * 無い値になり、画面表示と集計が壊れる。その退行を検知するためのテスト。
 */

describe("CUSTOMER_DOCUMENT_SPECS", () => {
  it("16項目ある", () => {
    expect(CUSTOMER_DOCUMENT_SPECS).toHaveLength(16);
    expect(CUSTOMER_DOCUMENT_KEYS.size).toBe(16);
  });

  it("キーが重複していない", () => {
    const keys = CUSTOMER_DOCUMENT_SPECS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("付近見取り図だけ「作成済み」", () => {
    expect(customerDocumentSpecByKey("vicinitySketchMap")?.completedValue).toBe(
      "作成済み",
    );
    const created = CUSTOMER_DOCUMENT_SPECS.filter(
      (s) => s.completedValue === "作成済み",
    );
    expect(created.map((s) => s.key)).toEqual(["vicinitySketchMap"]);
  });

  it("登記簿だけ「確認済み」", () => {
    expect(customerDocumentSpecByKey("registryBook")?.completedValue).toBe(
      "確認済み",
    );
    const confirmed = CUSTOMER_DOCUMENT_SPECS.filter(
      (s) => s.completedValue === "確認済み",
    );
    expect(confirmed.map((s) => s.key)).toEqual(["registryBook"]);
  });

  it("残り14項目は「回収済み」", () => {
    const collected = CUSTOMER_DOCUMENT_SPECS.filter(
      (s) => s.completedValue === "回収済み",
    );
    expect(collected).toHaveLength(14);
  });

  it("「回収済」（末尾みなし）は存在しない", () => {
    for (const spec of CUSTOMER_DOCUMENT_SPECS) {
      expect(spec.completedValue).not.toBe("回収済");
    }
  });

  it("完了値は3種類のみ", () => {
    const values = new Set(
      CUSTOMER_DOCUMENT_SPECS.map((s) => s.completedValue),
    );
    expect([...values].sort()).toEqual(["作成済み", "回収済み", "確認済み"].sort());
  });
});

describe("isCustomerDocumentKey", () => {
  it("16項目のキーを受け付ける", () => {
    expect(isCustomerDocumentKey("loanPaper")).toBe(true);
    expect(isCustomerDocumentKey("registryBook")).toBe(true);
  });

  it("書類以外のキーは拒否する（任意の列を更新させない）", () => {
    expect(isCustomerDocumentKey("customerName")).toBe(false);
    expect(isCustomerDocumentKey("pt")).toBe(false);
    expect(isCustomerDocumentKey("")).toBe(false);
    expect(isCustomerDocumentKey("__proto__")).toBe(false);
  });

  it("未知のキーでは spec が null", () => {
    expect(customerDocumentSpecByKey("nope")).toBeNull();
  });
});
