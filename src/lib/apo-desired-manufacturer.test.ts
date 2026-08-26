import { describe, expect, it } from "vitest";

import {
  formatApoDesiredManufacturers,
  hasApoDesiredManufacturerOther,
  parseApoDesiredManufacturers,
  APO_DESIRED_MANUFACTURER_OPTIONS,
  APO_DESIRED_MANUFACTURER_OTHER,
} from "@/lib/apo-desired-manufacturer";

describe("希望メーカーの選択肢", () => {
  it("★ 4つ（SHARP / XSOL / Panasonic / その他）", () => {
    expect(APO_DESIRED_MANUFACTURER_OPTIONS).toEqual([
      "SHARP",
      "XSOL",
      "Panasonic",
      "その他",
    ]);
    expect(APO_DESIRED_MANUFACTURER_OTHER).toBe("その他");
  });
});

describe("希望メーカーの @pocket 用文字列", () => {
  it("★ 複数選択を半角カンマで連結する", () => {
    expect(formatApoDesiredManufacturers("SHARP,XSOL,Panasonic")).toBe(
      "SHARP,XSOL,Panasonic",
    );
  });

  it("★ スペースを入れない", () => {
    const out = formatApoDesiredManufacturers("SHARP,XSOL");
    expect(out).toBe("SHARP,XSOL");
    expect(out).not.toContain(" ");
    expect(out).not.toContain(", ");
  });

  it("★ 区切りは半角カンマ（読点にしない）", () => {
    const out = formatApoDesiredManufacturers("SHARP,XSOL");
    expect(out).toContain(",");
    expect(out).not.toContain("、");
  });

  it("★ 選んだ順に関わらず定義順に並べる", () => {
    expect(formatApoDesiredManufacturers("Panasonic,SHARP")).toBe(
      "SHARP,Panasonic",
    );
    expect(formatApoDesiredManufacturers("その他,XSOL,SHARP")).toBe(
      "SHARP,XSOL,その他",
    );
    expect(formatApoDesiredManufacturers("Panasonic,その他,XSOL,SHARP")).toBe(
      "SHARP,XSOL,Panasonic,その他",
    );
  });

  it("1つだけならカンマを付けない", () => {
    expect(formatApoDesiredManufacturers("SHARP")).toBe("SHARP");
  });

  it("空欄は空文字（@pocket へ送らない合図）", () => {
    expect(formatApoDesiredManufacturers("")).toBe("");
    expect(formatApoDesiredManufacturers("   ")).toBe("");
    expect(formatApoDesiredManufacturers(undefined)).toBe("");
  });

  it("保存済みデータの区切りゆれ（読点・改行）も読める", () => {
    expect(formatApoDesiredManufacturers("SHARP、XSOL")).toBe("SHARP,XSOL");
    expect(formatApoDesiredManufacturers("SHARP\nXSOL")).toBe("SHARP,XSOL");
  });

  it("前後の空白は落とす", () => {
    expect(formatApoDesiredManufacturers(" SHARP , XSOL ")).toBe("SHARP,XSOL");
  });

  it("定義に無い値は落とさず末尾へ回す", () => {
    expect(formatApoDesiredManufacturers("未知,SHARP")).toBe("SHARP,未知");
  });
});

describe("その他メーカーを出すか", () => {
  it("★「その他」が選ばれていれば true", () => {
    expect(hasApoDesiredManufacturerOther("その他")).toBe(true);
    expect(hasApoDesiredManufacturerOther("SHARP,その他")).toBe(true);
    expect(hasApoDesiredManufacturerOther("その他,SHARP")).toBe(true);
  });

  it("★ 選ばれていなければ false", () => {
    expect(hasApoDesiredManufacturerOther("SHARP,XSOL")).toBe(false);
    expect(hasApoDesiredManufacturerOther("")).toBe(false);
    expect(hasApoDesiredManufacturerOther(undefined)).toBe(false);
  });

  it("部分一致では true にしない", () => {
    expect(hasApoDesiredManufacturerOther("その他メーカー")).toBe(false);
  });
});

describe("選択値の読み取り", () => {
  it("カンマ区切りを配列にする", () => {
    expect(parseApoDesiredManufacturers("SHARP,XSOL")).toEqual([
      "SHARP",
      "XSOL",
    ]);
  });

  it("空欄は空配列", () => {
    expect(parseApoDesiredManufacturers("")).toEqual([]);
    expect(parseApoDesiredManufacturers(undefined)).toEqual([]);
  });
});
