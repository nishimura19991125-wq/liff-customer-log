import { describe, expect, it } from "vitest";

import {
  formatCustomerNameForDisplay,
  normalizeCustomerNameSpacing,
} from "@/lib/customer-name-display";

const FULL = String.fromCharCode(0x3000);
const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);

describe("normalizeCustomerNameSpacing", () => {
  it("半角スペースを全角へ揃える", () => {
    const result = normalizeCustomerNameSpacing("杉原 正敏");
    expect(result).toBe(`杉原${FULL}正敏`);
    expect(result.charCodeAt(2)).toBe(0x3000);
  });

  it("全角スペースはそのまま", () => {
    expect(normalizeCustomerNameSpacing(`杉原${FULL}正敏`)).toBe(
      `杉原${FULL}正敏`,
    );
  });

  it("連続・混在した空白は全角1つに畳む", () => {
    expect(normalizeCustomerNameSpacing("杉原   正敏")).toBe(
      `杉原${FULL}正敏`,
    );
    expect(normalizeCustomerNameSpacing(`杉原 ${FULL} 正敏`)).toBe(
      `杉原${FULL}正敏`,
    );
  });

  it("タブ・改行も全角スペースになる", () => {
    expect(normalizeCustomerNameSpacing(`杉原${TAB}正敏`)).toBe(
      `杉原${FULL}正敏`,
    );
    expect(normalizeCustomerNameSpacing(`杉原${LF}正敏`)).toBe(
      `杉原${FULL}正敏`,
    );
  });

  it("前後の空白はトリムする", () => {
    expect(normalizeCustomerNameSpacing(`  杉原 正敏  `)).toBe(
      `杉原${FULL}正敏`,
    );
    expect(normalizeCustomerNameSpacing(`${FULL}杉原${FULL}正敏${FULL}`)).toBe(
      `杉原${FULL}正敏`,
    );
  });

  it("空・未入力は空文字", () => {
    expect(normalizeCustomerNameSpacing("")).toBe("");
    expect(normalizeCustomerNameSpacing("   ")).toBe("");
    expect(normalizeCustomerNameSpacing("-")).toBe("");
    expect(normalizeCustomerNameSpacing(undefined)).toBe("");
    expect(normalizeCustomerNameSpacing(null)).toBe("");
  });

  it("空白を含まない名前はそのまま", () => {
    expect(normalizeCustomerNameSpacing("杉原正敏")).toBe("杉原正敏");
  });
});

describe("formatCustomerNameForDisplay", () => {
  it("「様」を付ける", () => {
    expect(formatCustomerNameForDisplay("杉原 正敏")).toBe(
      `杉原${FULL}正敏様`,
    );
    expect(formatCustomerNameForDisplay("杉原正敏")).toBe("杉原正敏様");
  });

  it("既に「様」で終わっていれば二重に付けない", () => {
    expect(formatCustomerNameForDisplay("杉原 正敏様")).toBe(
      `杉原${FULL}正敏様`,
    );
    expect(formatCustomerNameForDisplay(`杉原${FULL}正敏様`)).toBe(
      `杉原${FULL}正敏様`,
    );
    expect(formatCustomerNameForDisplay("杉原正敏様")).toBe("杉原正敏様");
  });

  it("末尾の空白付きで「様」が入っていても二重にしない", () => {
    expect(formatCustomerNameForDisplay("杉原 正敏様  ")).toBe(
      `杉原${FULL}正敏様`,
    );
  });

  it("名前が空なら「様」も付けない", () => {
    expect(formatCustomerNameForDisplay("")).toBe("");
    expect(formatCustomerNameForDisplay("   ")).toBe("");
    expect(formatCustomerNameForDisplay("-")).toBe("");
    expect(formatCustomerNameForDisplay(undefined)).toBe("");
    expect(formatCustomerNameForDisplay(null)).toBe("");
  });

  it("名前の途中の「様」は影響しない", () => {
    expect(formatCustomerNameForDisplay("様田 太郎")).toBe(
      `様田${FULL}太郎様`,
    );
  });
});
