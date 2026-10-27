import { describe, expect, it } from "vitest";

import { buildContractRecordMap } from "@/lib/contract-records";

/**
 * 契約情報入力（お客様情報アプリ）の T番号 → 契約レコード（段階1）。
 *
 *   - 同じ T番号 が複数あれば、レコードIDが最も大きいもの（最後に登録）
 *   - T番号 は NFKC でそろえる
 */

function item(
  recordId: string,
  tNumber: string,
  extra: Partial<{
    customerName: string;
    contract: {
      manufacturer: string;
      panelCapacity: string;
      batteryCapacity1: string;
      batteryCapacity2: string;
      city: string;
    };
  }> = {},
) {
  return {
    recordId,
    tNumber,
    customerName: extra.customerName ?? `顧客${recordId}`,
    ...(extra.contract ? { contract: extra.contract } : {}),
  };
}

const SPEC = {
  manufacturer: "長州産業",
  panelCapacity: "5.6",
  batteryCapacity1: "9.8",
  batteryCapacity2: "",
  city: "福岡市",
};

describe("buildContractRecordMap", () => {
  it("★ T番号 → 契約レコード の Map ができる", () => {
    const m = buildContractRecordMap([
      item("10", "T0001", { customerName: "山田 太郎", contract: SPEC }),
    ]);

    expect(m.get("T0001")).toEqual({
      recordId: "10",
      tNumber: "T0001",
      customerName: "山田 太郎",
      ...SPEC,
    });
  });

  it("★ 同じ T番号 が複数なら、レコードIDが最大のものを使う（数値で比べる）", () => {
    const m = buildContractRecordMap([
      item("9", "T0001"),
      item("120", "T0001"),
      item("35", "T0001"),
    ]);

    // 文字列で比べると "9" が最大になってしまう
    expect(m.get("T0001")?.recordId).toBe("120");
  });

  it("★ 並び順に関係なく最大のものになる", () => {
    const m = buildContractRecordMap([item("120", "T0001"), item("9", "T0001")]);
    expect(m.get("T0001")?.recordId).toBe("120");
  });

  it("★ T番号 は NFKC でそろえる（全角と半角は同じ案件）", () => {
    const m = buildContractRecordMap([
      item("5", "Ｔ０００１"),
      item("6", "T0001"),
    ]);

    expect(m.size).toBe(1);
    expect(m.get("T0001")?.recordId).toBe("6");
  });

  it("★ 契約の列が無い行も、空文字で載る", () => {
    const m = buildContractRecordMap([item("10", "T0001")]);
    expect(m.get("T0001")).toMatchObject({
      manufacturer: "",
      panelCapacity: "",
      batteryCapacity1: "",
      batteryCapacity2: "",
      city: "",
    });
  });

  it("★ T番号 が空の行は載せない", () => {
    expect(buildContractRecordMap([item("10", "  ")]).size).toBe(0);
  });
});
