import { describe, expect, it } from "vitest";

import {
  CONTRACTOR_SUMMARY_PREFIX,
  buildContractorSummaryLine,
  buildContractorSummaryProduct,
} from "@/lib/contractor-summary-line";
import { buildConstructionRequestTemplate } from "@/lib/construction-request-template";
import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";

/**
 * タスクU: 施工会社向けの一行サマリ。
 *
 * 新規施工依頼（タスクH）とは扱いが違う点が多いので、
 * 「詰める」「①のみ」「項目ごと省く」を厚めに見る。
 */

const FULL: CustomerInfoFormValues = {
  constructionContractor: "ピュアライフ",
  city: "尼崎市",
  customerName: "テスト　太郎",
  manufacturer: "長州産業",
  panelCapacityKw: "5.775",
  batteryCapacity1: "7.7",
  batteryCapacity2: "5.6",
};

function build(values: CustomerInfoFormValues = {}): string {
  return buildContractorSummaryLine({ ...FULL, ...values });
}

describe("★ ① すべての値が揃っている場合", () => {
  it("実例どおりの一行になる", () => {
    expect(build()).toBe(
      "👷‍♂️ピュアライフ 尼崎市 テスト太郎様 長州産業5.775kW 7.7kWh",
    );
  });

  it("先頭は絵文字。直後に空白を入れない", () => {
    expect(build().startsWith(`${CONTRACTOR_SUMMARY_PREFIX}ピュアライフ`)).toBe(
      true,
    );
  });

  it("区切りは半角スペース1つ", () => {
    const body = build().slice(CONTRACTOR_SUMMARY_PREFIX.length);
    expect(body.split(" ")).toEqual([
      "ピュアライフ",
      "尼崎市",
      "テスト太郎様",
      "長州産業5.775kW",
      "7.7kWh",
    ]);
  });
});

describe("★ ② 蓄電池が空", () => {
  it("項目ごと省き、末尾にスペースが残らない", () => {
    const text = build({ batteryCapacity1: "" });
    expect(text).toBe("👷‍♂️ピュアライフ 尼崎市 テスト太郎様 長州産業5.775kW");
    expect(text.endsWith(" ")).toBe(false);
  });

  it("@pocket の「-」でも省く", () => {
    expect(build({ batteryCapacity1: "-" })).toBe(
      "👷‍♂️ピュアライフ 尼崎市 テスト太郎様 長州産業5.775kW",
    );
  });
});

describe("★ ③ 施工会社が空", () => {
  it("絵文字の直後に市区郡が来る", () => {
    expect(build({ constructionContractor: "" })).toBe(
      "👷‍♂️尼崎市 テスト太郎様 長州産業5.775kW 7.7kWh",
    );
  });
});

describe("★ ④ 複数の項目が空", () => {
  it("スペースが連続しない", () => {
    const text = build({
      constructionContractor: "",
      city: "",
      batteryCapacity1: "",
    });
    expect(text).toBe("👷‍♂️テスト太郎様 長州産業5.775kW");
    expect(text).not.toContain("  ");
  });

  it("どの組み合わせでも空白が連続せず、前後に余分な空白が付かない", () => {
    const keys = [
      "constructionContractor",
      "city",
      "customerName",
      "manufacturer",
      "panelCapacityKw",
      "batteryCapacity1",
    ] as const;

    // 各項目を空にした全パターン（2^6）を総当たりする
    for (let mask = 0; mask < 1 << keys.length; mask++) {
      const values: CustomerInfoFormValues = { ...FULL };
      keys.forEach((k, i) => {
        if (mask & (1 << i)) values[k] = "";
      });
      const text = buildContractorSummaryLine(values);
      if (!text) continue;
      const body = text.slice(CONTRACTOR_SUMMARY_PREFIX.length);
      expect(body).not.toContain("  ");
      expect(body).toBe(body.trim());
    }
  });

  it("すべて空なら空文字（絵文字だけの行は出さない）", () => {
    expect(
      buildContractorSummaryLine({
        constructionContractor: "",
        city: "",
        customerName: "",
        manufacturer: "",
        panelCapacityKw: "",
        batteryCapacity1: "",
      }),
    ).toBe("");
    expect(buildContractorSummaryLine({})).toBe("");
  });
});

describe("★ ⑤ 姓名の間のスペースを詰める", () => {
  it("全角スペースを詰める", () => {
    expect(build({ customerName: "テスト　太郎" })).toContain("テスト太郎様");
  });

  it("半角スペースを詰める", () => {
    expect(build({ customerName: "テスト 太郎" })).toContain("テスト太郎様");
  });

  it("空白が複数あっても詰める", () => {
    expect(build({ customerName: " テスト 　 太郎 " })).toContain(
      "テスト太郎様",
    );
  });

  it("新規施工依頼（タスクH）は従来どおり全角スペースを維持する", () => {
    const h = buildConstructionRequestTemplate({
      ...FULL,
      installationType: "太陽光パネル+蓄電池",
    });
    expect(h.ok).toBe(true);
    if (h.ok) {
      // H は詰めない。U の変更が H に波及していないこと
      expect(h.text).toContain(`テスト${String.fromCharCode(0x3000)}太郎様`);
    }
  });
});

describe("★ ⑥ 敬称", () => {
  it("「様」が付く", () => {
    expect(build({ customerName: "山田太郎" })).toContain("山田太郎様");
  });

  it("既に付いていれば二重にしない", () => {
    const text = build({ customerName: "山田太郎様" });
    expect(text).toContain("山田太郎様");
    expect(text).not.toContain("様様");
  });

  it("詰めたうえで既存の「様」を判定する", () => {
    const text = build({ customerName: "山田　太郎様" });
    expect(text).toContain("山田太郎様");
    expect(text).not.toContain("様様");
  });

  it("お客様名が空なら「様」も付けず項目ごと省く", () => {
    expect(build({ customerName: "" })).toBe(
      "👷‍♂️ピュアライフ 尼崎市 長州産業5.775kW 7.7kWh",
    );
  });
});

describe("★ ⑦ 単位が二重に付かない", () => {
  it("パネル容量に既に kW が入っていても足さない", () => {
    expect(build({ panelCapacityKw: "5.775kW" })).toContain("長州産業5.775kW");
    expect(build({ panelCapacityKw: "5.775kw" })).toContain("長州産業5.775kw");
  });

  it("蓄電池容量に既に kWh が入っていても足さない", () => {
    expect(build({ batteryCapacity1: "7.7kWh" })).toContain("7.7kWh");
    expect(build({ batteryCapacity1: "16.6kwh" })).toContain("16.6kwh");
    expect(build({ batteryCapacity1: "7.7kWh" })).not.toContain("kWhkWh");
  });

  it("kWh を kW と取り違えない（kWh は kw を含む）", () => {
    // パネル容量の欄に kWh 付きの値が入っても kW を足さない
    expect(build({ panelCapacityKw: "5.6kWh" })).toContain("長州産業5.6kWh");
    expect(build({ panelCapacityKw: "5.6kWh" })).not.toContain("kWhkW");
  });
});

describe("★ ⑧ 蓄電池容量②は使わない", () => {
  it("②に値があっても出力に現れない", () => {
    const text = build({ batteryCapacity1: "7.7", batteryCapacity2: "5.6" });
    expect(text).toContain("7.7kWh");
    expect(text).not.toContain("5.6");
    expect(text).not.toContain("+");
  });

  it("①が空なら②があっても蓄電池の項目ごと省く", () => {
    expect(build({ batteryCapacity1: "", batteryCapacity2: "5.6" })).toBe(
      "👷‍♂️ピュアライフ 尼崎市 テスト太郎様 長州産業5.775kW",
    );
  });
});

describe("メーカーとパネル容量の連結", () => {
  it("スペースなしで連結する", () => {
    expect(buildContractorSummaryProduct(FULL)).toBe("長州産業5.775kW");
  });

  it("メーカーのみなら メーカーだけ", () => {
    expect(
      buildContractorSummaryProduct({ ...FULL, panelCapacityKw: "" }),
    ).toBe("長州産業");
    expect(build({ panelCapacityKw: "" })).toBe(
      "👷‍♂️ピュアライフ 尼崎市 テスト太郎様 長州産業 7.7kWh",
    );
  });

  it("パネル容量のみなら 容量だけ", () => {
    expect(buildContractorSummaryProduct({ ...FULL, manufacturer: "" })).toBe(
      "5.775kW",
    );
    expect(build({ manufacturer: "" })).toBe(
      "👷‍♂️ピュアライフ 尼崎市 テスト太郎様 5.775kW 7.7kWh",
    );
  });

  it("両方空なら項目ごと省く", () => {
    expect(
      buildContractorSummaryProduct({
        ...FULL,
        manufacturer: "",
        panelCapacityKw: "",
      }),
    ).toBe("");
    expect(build({ manufacturer: "", panelCapacityKw: "" })).toBe(
      "👷‍♂️ピュアライフ 尼崎市 テスト太郎様 7.7kWh",
    );
  });
});
