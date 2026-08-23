import { describe, expect, it } from "vitest";

import {
  findMissingRequiredCustomerInfoFields,
  isCustomerInfoFieldRequired,
  isCustomerInfoVisibleFieldValueMissing,
} from "@/lib/customer-info-form/validate";
import { isIndoorSurveyStatusNotDone } from "@/lib/customer-info-form/options";

const breakerField = {
  key: "breakerAmps",
  label: "分電盤アンペア数",
  type: "select" as const,
};

const cosmeticField = {
  key: "cosmeticCover",
  label: "化粧カバー",
  type: "checkbox-group" as const,
};

const otherRequiredField = {
  key: "manufacturer",
  label: "メーカー",
  type: "select" as const,
};

describe("isCustomerInfoFieldRequired", () => {
  it("treats schema required:false as optional", () => {
    expect(
      isCustomerInfoFieldRequired(
        { key: "contractPowerCompany", required: false },
        {},
      ),
    ).toBe(false);
  });

  it("relaxes breaker and cosmetic when indoor survey is 未実施", () => {
    const values = { indoorSurveyStatus: "未実施" };
    expect(isCustomerInfoFieldRequired(breakerField, values)).toBe(false);
    expect(isCustomerInfoFieldRequired(cosmeticField, values)).toBe(false);
    expect(isCustomerInfoFieldRequired(otherRequiredField, values)).toBe(true);
  });

  it("requires breaker and cosmetic when indoor survey is 実施済み", () => {
    const values = { indoorSurveyStatus: "実施済み" };
    expect(isCustomerInfoFieldRequired(breakerField, values)).toBe(true);
    expect(isCustomerInfoFieldRequired(cosmeticField, values)).toBe(true);
  });

  it("relaxes all fields when customer status is cancelled", () => {
    const values = {
      customerStatus: "キャンセル",
      indoorSurveyStatus: "実施済み",
    };
    expect(isCustomerInfoFieldRequired(breakerField, values)).toBe(false);
    expect(isCustomerInfoFieldRequired(otherRequiredField, values)).toBe(false);
  });

  it("relaxes all fields when treatAllRequiredAsOptional is set", () => {
    const values = {
      customerStatus: "工事待ち",
      indoorSurveyStatus: "実施済み",
    };
    expect(
      isCustomerInfoFieldRequired(breakerField, values, {
        treatAllRequiredAsOptional: true,
      }),
    ).toBe(false);
    expect(
      isCustomerInfoFieldRequired(otherRequiredField, values, {
        treatAllRequiredAsOptional: true,
      }),
    ).toBe(false);
  });

  it("matches 未実施 with NFKC normalization", () => {
    expect(isIndoorSurveyStatusNotDone("未実施")).toBe(true);
    expect(isIndoorSurveyStatusNotDone("未\u3000実施")).toBe(false);
  });
});

describe("isCustomerInfoVisibleFieldValueMissing", () => {
  it("ignores empty breaker and cosmetic when indoor survey is 未実施", () => {
    const values = { indoorSurveyStatus: "未実施" };
    expect(
      isCustomerInfoVisibleFieldValueMissing(breakerField, values),
    ).toBe(false);
    expect(
      isCustomerInfoVisibleFieldValueMissing(cosmeticField, values),
    ).toBe(false);
  });

  it("flags empty breaker when indoor survey is 実施済み", () => {
    expect(
      isCustomerInfoVisibleFieldValueMissing(breakerField, {
        indoorSurveyStatus: "実施済み",
      }),
    ).toBe(true);
  });
});

describe("findMissingRequiredCustomerInfoFields", () => {
  it("returns no missing fields for cancelled records with many blanks", () => {
    const missing = findMissingRequiredCustomerInfoFields(
      [breakerField, cosmeticField, otherRequiredField],
      {
        customerStatus: "キャンセル",
        indoorSurveyStatus: "実施済み",
      },
    );
    expect(missing).toEqual([]);
  });
});
