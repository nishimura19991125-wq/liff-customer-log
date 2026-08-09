import { describe, expect, it } from "vitest";

import {
  CUSTOMER_DOCUMENT_KEYS,
  CUSTOMER_DOCUMENT_SPECS,
  customerDocumentSpecByKey,
  isCustomerDocumentKey,
} from "@/lib/customer-documents-spec";
import { CUSTOMER_INFO_FORM_FIELD_MAP } from "@/lib/customer-info-form/schema";

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

/**
 * 完了値・未回収値は、その項目の選択肢に必ず含まれていなければならない。
 * 含まれないと、画面のラジオが未選択に見えるのに値だけが入る状態になり、
 * 「不要」焼き付き（タスクG）と同じ事故が再発する。
 */
describe("完了値・未回収値と選択肢の整合", () => {
  it("16項目とも completedValue が選択肢に含まれる", () => {
    for (const spec of CUSTOMER_DOCUMENT_SPECS) {
      const options = CUSTOMER_INFO_FORM_FIELD_MAP.get(spec.key)?.options ?? [];
      expect(options, `${spec.caption} の選択肢`).toContain(
        spec.completedValue,
      );
    }
  });

  it("16項目とも pendingValue が選択肢に含まれる", () => {
    for (const spec of CUSTOMER_DOCUMENT_SPECS) {
      const options = CUSTOMER_INFO_FORM_FIELD_MAP.get(spec.key)?.options ?? [];
      expect(options, `${spec.caption} の選択肢`).toContain(spec.pendingValue);
    }
  });

  it("非表示時の既定値（不要）も選択肢に含まれる", () => {
    for (const spec of CUSTOMER_DOCUMENT_SPECS) {
      const def = CUSTOMER_INFO_FORM_FIELD_MAP.get(spec.key);
      const hiddenValue = def?.hiddenValue;
      if (!hiddenValue) continue;
      expect(def?.options ?? [], `${spec.caption} の選択肢`).toContain(
        hiddenValue,
      );
    }
  });

  it("補助金事前申請書類の選択肢は3つ（一部回収済みは廃止）", () => {
    const options =
      CUSTOMER_INFO_FORM_FIELD_MAP.get("subsidyPreApplicationDocs")?.options ??
      [];
    expect(options).toEqual(["未回収", "回収済み", "不要"]);
    expect(options).not.toContain("一部回収済み");
  });

  it("どの項目にも「一部回収済み」が残っていない", () => {
    for (const spec of CUSTOMER_DOCUMENT_SPECS) {
      const options = CUSTOMER_INFO_FORM_FIELD_MAP.get(spec.key)?.options ?? [];
      expect(options, `${spec.caption} の選択肢`).not.toContain("一部回収済み");
    }
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
