import { describe, expect, it } from "vitest";

import { tNumberJoinKey } from "@/lib/t-number-join-key";
import { buildZankoIndex, emptyZankoIndex } from "@/lib/zanko-index";

/**
 * 残工案件アプリ（186）の T番号 → 残工日[]（段階1）。
 *
 *   - 全レコードを残工として扱う（ステータスは見ない）
 *   - 残工日が空でも T番号 は載る（段階3の【延期】で使う）
 *   - 残工日が空のレコードがあったことを持つ（段階4で使う）
 *   - 同じ T番号・同じ日付は1件にまとめ、日付は昇順
 *   - T番号 は NFKC でそろえる（施工管理タブと同じ）
 */

const T = "field-3";
const D = "field-7";
const STATUS = "field-2";
const FIDS = { tNumberFieldId: T, dateFieldId: D };

function row(recordId: number, record: Record<string, unknown>) {
  return { recordId, record };
}

describe("tNumberJoinKey（NFKC）", () => {
  it("★ 全角を半角にそろえる", () => {
    expect(tNumberJoinKey("Ｔ０００３４２０")).toBe("T0003420");
  });

  it("★ 前後の空白を落とし、連続空白を1つにする", () => {
    expect(tNumberJoinKey("  T0003420 ")).toBe("T0003420");
    expect(tNumberJoinKey("T 0003　420")).toBe("T 0003 420");
  });

  it("★ @pocket の値の形（オブジェクト・数値）も読む", () => {
    expect(tNumberJoinKey({ value: "Ｔ１" })).toBe("T1");
    expect(tNumberJoinKey(123)).toBe("123");
  });

  it("★ 空は空文字", () => {
    expect(tNumberJoinKey(null)).toBe("");
    expect(tNumberJoinKey("  ")).toBe("");
  });
});

describe("buildZankoIndex", () => {
  it("★ T番号 → 残工日[] の Map ができる", () => {
    const idx = buildZankoIndex(
      [
        row(1, { [T]: "T0001", [D]: "2026-11-05" }),
        row(2, { [T]: "T0002", [D]: "2026-12-01" }),
      ],
      FIDS,
    );

    expect(idx.datesByT.get("T0001")).toEqual(["2026-11-05"]);
    expect(idx.datesByT.get("T0002")).toEqual(["2026-12-01"]);
    expect(idx.datesByT.size).toBe(2);
  });

  it("★ 残工日が空でも T番号 は載る（空配列）", () => {
    const idx = buildZankoIndex([row(1, { [T]: "T0001", [D]: "" })], FIDS);

    expect(idx.datesByT.has("T0001")).toBe(true);
    expect(idx.datesByT.get("T0001")).toEqual([]);
  });

  it("★ 残工日の列そのものが無いレコードも T番号 は載る", () => {
    const idx = buildZankoIndex([row(1, { [T]: "T0001" })], FIDS);
    expect(idx.datesByT.get("T0001")).toEqual([]);
  });

  it("★ 残工日が空のレコードがあったことが分かる（T番号ごと・件数）", () => {
    const idx = buildZankoIndex(
      [
        row(1, { [T]: "T0001", [D]: "2026-11-05" }),
        row(2, { [T]: "T0001", [D]: "" }),
        row(3, { [T]: "T0002", [D]: "2026-11-06" }),
        row(4, { [T]: "T0003", [D]: "読めない" }),
      ],
      FIDS,
    );

    expect([...idx.tNumbersWithUndated].sort()).toEqual(["T0001", "T0003"]);
    expect(idx.undatedRecordCount).toBe(2);
    // 日付があるほうは残る
    expect(idx.datesByT.get("T0001")).toEqual(["2026-11-05"]);
    expect(idx.datesByT.get("T0003")).toEqual([]);
  });

  it("★ 同じ T番号・同じ日付は1件にまとまる（表記ゆれも同じ日付として扱う）", () => {
    const idx = buildZankoIndex(
      [
        row(1, { [T]: "T0001", [D]: "2026-11-05" }),
        row(2, { [T]: "T0001", [D]: "2026/11/05" }),
        row(3, { [T]: "Ｔ０００１", [D]: "2026-11-05" }),
      ],
      FIDS,
    );

    expect(idx.datesByT.get("T0001")).toEqual(["2026-11-05"]);
  });

  it("★ 日付は昇順", () => {
    const idx = buildZankoIndex(
      [
        row(1, { [T]: "T0001", [D]: "2026-12-10" }),
        row(2, { [T]: "T0001", [D]: "2026-11-05" }),
        row(3, { [T]: "T0001", [D]: "2027-01-02" }),
      ],
      FIDS,
    );

    expect(idx.datesByT.get("T0001")).toEqual([
      "2026-11-05",
      "2026-12-10",
      "2027-01-02",
    ]);
  });

  it("★ T番号 は NFKC でそろえて突き合わせる", () => {
    const idx = buildZankoIndex(
      [row(1, { [T]: "Ｔ０００１", [D]: "2026-11-05" })],
      FIDS,
    );

    expect(idx.datesByT.has("T0001")).toBe(true);
    expect(idx.datesByT.has("Ｔ０００１")).toBe(false);
  });

  it("★ ステータス（報告内容）は見ない。全レコードを残工として扱う", () => {
    const idx = buildZankoIndex(
      [
        row(1, { [T]: "T0001", [D]: "2026-11-05", [STATUS]: "完工" }),
        row(2, { [T]: "T0002", [D]: "2026-11-06", [STATUS]: "" }),
      ],
      FIDS,
    );

    expect(idx.datesByT.size).toBe(2);
  });

  it("★ T番号 が空のレコードは載せない", () => {
    const idx = buildZankoIndex([row(1, { [T]: "", [D]: "2026-11-05" })], FIDS);
    expect(idx.datesByT.size).toBe(0);
    expect(idx.undatedRecordCount).toBe(0);
  });

  it("★ field_N の表記ゆれでも読む", () => {
    const idx = buildZankoIndex(
      [row(1, { field_3: "T0001", field_7: "2026-11-05" })],
      FIDS,
    );
    expect(idx.datesByT.get("T0001")).toEqual(["2026-11-05"]);
  });

  it("★ emptyZankoIndex は何も持たない", () => {
    const idx = emptyZankoIndex();
    expect(idx.datesByT.size).toBe(0);
    expect(idx.tNumbersWithUndated.size).toBe(0);
    expect(idx.undatedRecordCount).toBe(0);
  });
});
