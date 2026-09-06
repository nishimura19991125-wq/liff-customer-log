import { describe, expect, it } from "vitest";

import { buildCustomerInfoFormPayload } from "@/lib/customer-info-form/rules";
import { CUSTOMER_INFO_FORM_FIELDS } from "@/lib/customer-info-form/schema";
import type {
  CustomerInfoFormFieldResolved,
  CustomerInfoFormValues,
} from "@/lib/customer-info-form/types";

/**
 * 実際のスキーマから解決済みフィールドを組み立てる。
 * fieldId は「そのキー」をそのまま使い、payload を読みやすくする。
 */
function resolveAll(): CustomerInfoFormFieldResolved[] {
  return CUSTOMER_INFO_FORM_FIELDS.map((f) => ({
    ...f,
    fieldId: f.liffOnly ? "" : f.key,
    label: f.caption,
    value: "",
  }));
}

const RESOLVED = resolveAll();

function payloadFor(values: CustomerInfoFormValues): Record<string, unknown> {
  return buildCustomerInfoFormPayload(values, RESOLVED);
}

/** 太陽光パネルの入力が見える設置種別 */
const WITH_PANEL = "太陽光パネル+蓄電池";
/** パネルが非表示になる設置種別 */
const WITHOUT_PANEL = "蓄電池のみ";

describe("M-1: 非表示になった項目は payload から落とす", () => {
  const filled: CustomerInfoFormValues = {
    installationType: WITH_PANEL,
    panelCombo: "無",
    panelModel1: "PANEL-A",
    panelCount1: "20",
    panelCapacityKw: "5.6",
  };

  it("表示中は従来どおり書き込む", () => {
    const p = payloadFor(filled);
    expect(p.panelModel1).toBe("PANEL-A");
    expect(p.panelCount1).toBe("20");
    expect(p.panelCapacityKw).toBe("5.6");
  });

  it("★ 設置種別を切り替えて非表示になったら送らない（@pocket の値が残る）", () => {
    const p = payloadFor({ ...filled, installationType: WITHOUT_PANEL });
    expect(p).not.toHaveProperty("panelModel1");
    expect(p).not.toHaveProperty("panelCount1");
    expect(p).not.toHaveProperty("panelCapacityKw");
  });

  it("★ 値が空でも、非表示なら送らない（0 や - で潰さない）", () => {
    const p = payloadFor({
      installationType: WITHOUT_PANEL,
      panelCombo: "無",
      panelModel1: "",
      panelCount1: "",
      panelCapacityKw: "",
    });
    expect(p).not.toHaveProperty("panelModel1");
    expect(p).not.toHaveProperty("panelCount1");
    expect(p).not.toHaveProperty("panelCapacityKw");
  });

  it("★ panelCapacityKw の個別保護を外しても、値がある場合は従来どおり残る", () => {
    // 以前は hasDecimalKwValue のときだけ保護していた。
    // いまは分岐に吸収され、非表示なら常に送らない
    const p = payloadFor({ ...filled, installationType: WITHOUT_PANEL });
    expect(p).not.toHaveProperty("panelCapacityKw");
  });

  it("★ 以前は 0 が書かれていた「非表示かつ 0」も送らなくなる", () => {
    const p = payloadFor({
      installationType: WITHOUT_PANEL,
      panelCombo: "無",
      panelCapacityKw: "0",
      panelCount1: "0",
    });
    expect(p).not.toHaveProperty("panelCapacityKw");
    expect(p).not.toHaveProperty("panelCount1");
  });
});

describe("M-1: 表示中の項目は従来どおり", () => {
  it("表示中に空にしたら 0 が書かれる（数量・金額）", () => {
    const p = payloadFor({
      installationType: WITH_PANEL,
      panelCombo: "無",
      panelCount1: "",
      panelCapacityKw: "",
    });
    expect(p.panelCount1).toBe("0");
    expect(p.panelCapacityKw).toBe("0");
  });

  it("表示中に空にしたら - が書かれる（型番）", () => {
    const p = payloadFor({
      installationType: WITH_PANEL,
      panelCombo: "無",
      panelModel1: "",
    });
    expect(p.panelModel1).toBe("-");
  });

  it("表示中はカンマを外して書き込む", () => {
    const p = payloadFor({
      installationType: WITH_PANEL,
      panelCombo: "無",
      panelCount1: "1,200",
    });
    expect(p.panelCount1).toBe("1200");
  });
});

describe("M-1: 書類ステータスの扱いを変えていない（タスクG）", () => {
  /** 設置種別が「蓄電池のみ」のときだけ出る書類 */
  const DOC_KEY = "powerOfAttorneyChangeCert";

  it("非表示かつ空なら従来どおり hiddenValue（不要）を書く", () => {
    const p = payloadFor({
      installationType: WITH_PANEL, // この書類は非表示になる設置種別
      panelCombo: "無",
      [DOC_KEY]: "",
    });
    expect(p[DOC_KEY]).toBe("不要");
  });

  it("非表示でも実データが残っていれば送らない（従来どおり保護）", () => {
    const p = payloadFor({
      installationType: WITH_PANEL,
      panelCombo: "無",
      [DOC_KEY]: "回収済み",
    });
    expect(p).not.toHaveProperty(DOC_KEY);
  });

  it("表示中はその値をそのまま書く", () => {
    const p = payloadFor({
      installationType: "蓄電池のみ",
      panelCombo: "無",
      [DOC_KEY]: "回収済み",
    });
    expect(p[DOC_KEY]).toBe("回収済み");
  });
});

/**
 * 追加部材の金額を数値として扱う。
 *
 * @pocket の列は数値型なのにアプリ側は text（自由入力）で、「10000円」と
 * 入力すると「円」ごと送られて 400 になり、画面にはどの項目が原因か
 * 出なかった。契約金額・現金・ローン金額・紹介手数料と同じ扱いにそろえる。
 */
describe("追加部材の金額（数値として扱う）", () => {
  const withExtraParts: CustomerInfoFormValues = {
    installationType: WITH_PANEL,
    extraParts: "有",
    extraPartsName: "架台",
    extraPartsAmount: "10,000",
  };

  it("★ 単位付きで入力してもカンマなしの整数で送る", () => {
    const payload = payloadFor({
      ...withExtraParts,
      extraPartsAmount: "10000円",
    });
    expect(payload.extraPartsAmount).toBe("10000");
  });

  it("★ 3桁カンマ付きで入力してもカンマなしの整数で送る", () => {
    expect(payloadFor(withExtraParts).extraPartsAmount).toBe("10000");
  });

  it("表示中に空なら 0 を送る（従来どおり）", () => {
    const payload = payloadFor({ ...withExtraParts, extraPartsAmount: "" });
    expect(payload.extraPartsAmount).toBe("0");
  });

  it("★ 「有」→「無」に変えて保存しても、金額の列に何も書き込まない", () => {
    const payload = payloadFor({
      ...withExtraParts,
      extraParts: "無",
    });

    // "-" は数値列で 400 になり、"0" は入力済みの金額を潰す
    expect(payload).not.toHaveProperty("extraPartsAmount");
  });

  it("「無」にしても、既に入っている金額を 0 で潰さない", () => {
    const payload = payloadFor({
      ...withExtraParts,
      extraPartsAmount: "50,000",
      extraParts: "無",
    });
    expect(Object.values(payload)).not.toContain("50000");
    expect(payload).not.toHaveProperty("extraPartsAmount");
  });
});
