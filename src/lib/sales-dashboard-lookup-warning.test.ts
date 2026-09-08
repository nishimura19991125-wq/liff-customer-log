import { describe, expect, it } from "vitest";

import { isLookupConfigFailure } from "@/lib/sales-dashboard-lookup-warning";

describe("★ 一部が引けないだけなら警告にしない", () => {
  it("41人中12人が未登録でも警告にしない", () => {
    expect(isLookupConfigFailure({ missing: 12, total: 41 })).toBe(false);
  });

  it("目標を持たない人が21人いても警告にしない", () => {
    expect(isLookupConfigFailure({ missing: 21, total: 41 })).toBe(false);
  });

  it("1人だけ未登録でも警告にしない（所属支社の想定）", () => {
    expect(isLookupConfigFailure({ missing: 2, total: 41 })).toBe(false);
  });

  it("全員引けていれば警告にしない", () => {
    expect(isLookupConfigFailure({ missing: 0, total: 41 })).toBe(false);
  });

  it("あと1人で全員というところでも警告にしない", () => {
    expect(isLookupConfigFailure({ missing: 40, total: 41 })).toBe(false);
  });
});

describe("★ 1人も引けないときは警告する", () => {
  it("missing === total なら警告", () => {
    expect(isLookupConfigFailure({ missing: 41, total: 41 })).toBe(true);
  });

  it("参照元を読めていても、1人も引けなければ警告", () => {
    expect(
      isLookupConfigFailure({ missing: 41, total: 41, available: true }),
    ).toBe(true);
  });
});

describe("★ 参照元を読めないときは警告する", () => {
  it("available が false なら人数によらず警告", () => {
    expect(
      isLookupConfigFailure({ missing: 0, total: 41, available: false }),
    ).toBe(true);
    expect(
      isLookupConfigFailure({ missing: 12, total: 41, available: false }),
    ).toBe(true);
  });

  it("available が true なら一部未登録では警告にしない", () => {
    expect(
      isLookupConfigFailure({ missing: 12, total: 41, available: true }),
    ).toBe(false);
  });

  it("available 未指定は「読めている」とみなす（所属支社の経路）", () => {
    expect(isLookupConfigFailure({ missing: 12, total: 41 })).toBe(false);
  });
});

describe("★ 防御", () => {
  it("対象が0人なら警告にしない（引けなかったものが無い）", () => {
    expect(isLookupConfigFailure({ missing: 0, total: 0 })).toBe(false);
  });

  it("対象が0人でも、参照元を読めていなければ警告", () => {
    expect(
      isLookupConfigFailure({ missing: 0, total: 0, available: false }),
    ).toBe(true);
  });

  it("missing が total を超えていても警告（数え方が壊れた場合の保険）", () => {
    expect(isLookupConfigFailure({ missing: 42, total: 41 })).toBe(true);
  });
});
