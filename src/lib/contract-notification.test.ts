import { describe, expect, it } from "vitest";

import {
  buildContractNotificationText,
  formatContractAmount,
  shouldSendContractNotification,
} from "@/lib/contract-notification";
import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";

/** 全項目が埋まっている案件 */
const FULL: CustomerInfoFormValues = {
  inputStatus: "入力完了",
  contractDate: "2026-08-18",
  apStaff: "西村太郎",
  clStaff: "冨田菜摘",
  pt: "1,200",
  customerName: "山田太郎",
  furigana: "ヤマダタロウ",
  postalCode: "123-4567",
  prefecture: "愛知県",
  city: "名古屋市中区",
  address: "栄1-2-3",
  phone: "090-1234-5678",
  introduction: "紹介",
  panelModel1: "AAA-100",
  panelModel2: "BBB-200",
  panelCount1: "12",
  panelCount2: "6",
  powerConCount: "2",
  powerConModel1: "PC-1",
  powerConModel2: "PC-2",
  batteryCapacity1: "5.6",
  batteryCapacity2: "5.6",
  roofMaterial: "和瓦",
  roofMaterialModel: "KAWARA-9",
  fitType: "FIT",
  contractPowerCompany: "中部電力",
  contractPowerPlan: "従量電灯B",
  cosmeticCover: "黒,白",
  breakerAmps: "60A",
  paymentMethod: "ローン",
  creditCompany: "ジャックス",
  contractAmount: "3500000",
  cashAmount: "500000",
  loanAmount: "3000000",
  extraPartsName: "架台",
  extraPartsUrl: "https://example.test/parts",
  extraPartsAmount: "120000",
  installationType: "太陽光パネル+蓄電池",
  subsidy: "有",
  preApplication: "無",
};

function build(
  values: CustomerInfoFormValues = {},
  extras: { tNumber?: string; batteryLocation?: string } = {},
): string {
  return buildContractNotificationText({
    values: { ...FULL, ...values },
    tNumber: extras.tNumber ?? "T-1483",
    batteryLocation: extras.batteryLocation ?? "屋内",
  });
}

function line(text: string, prefix: string): string | undefined {
  return text.split("\n").find((l) => l.startsWith(prefix));
}

describe("送信の判定（未入力 → 入力完了 のときだけ）", () => {
  it("★「未入力」→「入力完了」で送る", () => {
    expect(shouldSendContractNotification("未入力", "入力完了")).toBe(true);
  });

  it("★ 既に「入力完了」の状態で再保存しても送らない", () => {
    expect(shouldSendContractNotification("入力完了", "入力完了")).toBe(false);
  });

  it("★「入力完了」→「未入力」では送らない", () => {
    expect(shouldSendContractNotification("入力完了", "未入力")).toBe(false);
  });

  it("空・未設定から「入力完了」なら送る", () => {
    expect(shouldSendContractNotification("", "入力完了")).toBe(true);
    expect(shouldSendContractNotification("-", "入力完了")).toBe(true);
  });

  it("保存前の値を読めていない（null）ときは送らない", () => {
    // 重複通知を避けるため、判定できないときは送らない側に倒す
    expect(shouldSendContractNotification(null, "入力完了")).toBe(false);
    expect(shouldSendContractNotification(undefined, "入力完了")).toBe(false);
  });

  it("全角・空白のゆれは同じ値として扱う（NFKC・空白正規化）", () => {
    expect(shouldSendContractNotification("入力完了", " 入力 完了 ")).toBe(
      false,
    );
  });
});

describe("本文の組み立て", () => {
  it("★ 1行目は【契約速報】", () => {
    expect(build().split("\n")[0]).toBe("【契約速報】");
  });

  it("★ 値が空でも行は残し、値だけ空欄にする", () => {
    const text = build({
      apStaff: "",
      creditCompany: "",
      roofMaterial: "-",
      cosmeticCover: "",
    });
    expect(line(text, "AP担当者：")).toBe("AP担当者：");
    expect(line(text, "信販会社：")).toBe("信販会社：");
    expect(line(text, "屋根材：")).toBe("屋根材：");
    expect(line(text, "化粧カバー：")).toBe("化粧カバー：");
  });

  it("項目の並びと行数が定義どおり", () => {
    const lines = build().split("\n");
    expect(lines).toHaveLength(35);
    expect(lines.slice(1, 8).map((l) => l.split("：")[0])).toEqual([
      "T番号",
      "契約日",
      "AP担当者",
      "APPT",
      "CL担当者",
      "CLPT",
      "お客様名",
    ]);
    expect(lines[lines.length - 1].split("：")[0]).toBe("事前申請有無");
  });

  it("郵便番号の 〒 は固定で付ける（値が空でも残る）", () => {
    expect(line(build(), "郵便番号：")).toBe("郵便番号：〒123-4567");
    expect(line(build({ postalCode: "" }), "郵便番号：")).toBe("郵便番号：〒");
  });

  it("契約日は yyyy/mm/dd", () => {
    expect(line(build(), "契約日：")).toBe("契約日：2026/08/18");
    expect(line(build({ contractDate: "" }), "契約日：")).toBe("契約日：");
  });

  it("T番号・蓄電池設置箇所はフォーム外の値から入る", () => {
    const text = build({}, { tNumber: "T-9999", batteryLocation: "屋外" });
    expect(line(text, "T番号：")).toBe("T番号：T-9999");
    expect(line(text, "蓄電池：")).toContain("屋外");
  });
});

describe("★ 複合する項目", () => {
  it("設置住所は 都道府県 + 市区郡 + 番地", () => {
    expect(line(build(), "設置住所：")).toBe("設置住所：愛知県名古屋市中区栄1-2-3");
  });

  it("設置住所は空の部分を詰めて連結する", () => {
    expect(line(build({ city: "" }), "設置住所：")).toBe("設置住所：愛知県栄1-2-3");
    expect(
      line(build({ prefecture: "", city: "", address: "" }), "設置住所："),
    ).toBe("設置住所：");
  });

  it("太陽光は（品番① + 品番②）枚数①枚 + 枚数②枚", () => {
    expect(line(build(), "太陽光：")).toBe(
      "太陽光：（AAA-100 + BBB-200）12枚 + 6枚",
    );
  });

  it("太陽光は②が無ければ①だけ", () => {
    expect(
      line(build({ panelModel2: "", panelCount2: "" }), "太陽光："),
    ).toBe("太陽光：（AAA-100）12枚");
  });

  it("★ 枚数②が 0 なら「+」も②も出さない（実機の「10 + 0」対策）", () => {
    expect(
      line(build({ panelModel2: "", panelCount1: "10", panelCount2: "0" }), "太陽光："),
    ).toBe("太陽光：（AAA-100）10枚");
  });

  it("太陽光は品番が無ければ（）ごと出さない", () => {
    expect(
      line(build({ panelModel1: "", panelModel2: "" }), "太陽光："),
    ).toBe("太陽光：12枚 + 6枚");
    expect(
      line(
        build({
          panelModel1: "",
          panelModel2: "",
          panelCount1: "",
          panelCount2: "",
        }),
        "太陽光：",
      ),
    ).toBe("太陽光：");
  });

  it("パワコン品番は ① + ②", () => {
    expect(line(build(), "パワコン品番：")).toBe("パワコン品番：PC-1 + PC-2");
    expect(line(build({ powerConModel2: "" }), "パワコン品番：")).toBe(
      "パワコン品番：PC-1",
    );
  });

  it("蓄電池は 全負荷、容量① + 容量②、設置箇所", () => {
    expect(line(build(), "蓄電池：")).toBe("蓄電池：全負荷、5.6kWh + 5.6kWh、屋内");
  });

  it("蓄電池は容量・設置箇所が空でも全負荷だけ残す", () => {
    expect(
      line(
        build(
          { batteryCapacity1: "-", batteryCapacity2: "-" },
          { batteryLocation: "" },
        ),
        "蓄電池：",
      ),
    ).toBe("蓄電池：全負荷");
  });

  it("★ 蓄電池容量②が 0 なら「+」も②も出さない", () => {
    expect(
      line(build({ batteryCapacity2: "0" }), "蓄電池："),
    ).toBe("蓄電池：全負荷、5.6kWh、屋内");
  });

  it("創蓄or蓄単or太単は設置種別の値をそのまま出す", () => {
    expect(line(build(), "創蓄or蓄単or太単：")).toBe(
      "創蓄or蓄単or太単：太陽光パネル+蓄電池",
    );
  });

  it("追加部材は「追加部材の商品名」列の値", () => {
    expect(line(build(), "追加部材：")).toBe("追加部材：架台");
    expect(line(build(), "追加部材URL：")).toBe(
      "追加部材URL：https://example.test/parts",
    );
  });
});

describe("★ 金額の3桁区切りと「円」", () => {
  it("契約金額・現金・ローン金額・追加部材の金額", () => {
    const text = build();
    expect(line(text, "契約金額：")).toBe("契約金額：3,500,000円");
    expect(line(text, "現金：")).toBe("現金：500,000円");
    expect(line(text, "ローン金額：")).toBe("ローン金額：3,000,000円");
    expect(line(text, "追加部材の金額：")).toBe("追加部材の金額：120,000円");
  });

  it("APPT・CLPT は computePtTransfer の結果を3桁区切りで出す", () => {
    // AP と CL が別人なので PT を折半（1200 → 600 / 600）
    const text = build({ pt: "1,200" });
    expect(line(text, "APPT：")).toBe("APPT：600円");
    expect(line(text, "CLPT：")).toBe("CLPT：600円");

    // 同一担当なら CLPT に全額・APPT は 0
    const same = build({ apStaff: "西村太郎", clStaff: "西村太郎", pt: "12000" });
    expect(line(same, "APPT：")).toBe("APPT：0円");
    expect(line(same, "CLPT：")).toBe("CLPT：12,000円");
  });

  it("★ 0 は「0円」と出す（@pocket の 0 と未入力は別物）", () => {
    const zero = build({
      contractAmount: "0",
      cashAmount: "0",
      loanAmount: "0",
      extraPartsAmount: "0",
    });
    expect(line(zero, "契約金額：")).toBe("契約金額：0円");
    expect(line(zero, "現金：")).toBe("現金：0円");
    expect(line(zero, "ローン金額：")).toBe("ローン金額：0円");
    expect(line(zero, "追加部材の金額：")).toBe("追加部材の金額：0円");
  });

  it("★ @pocket が未入力なら空欄。単位も付けない", () => {
    const empty = build({
      contractAmount: "",
      cashAmount: "-",
      loanAmount: "",
      extraPartsAmount: "",
    });
    expect(line(empty, "契約金額：")).toBe("契約金額：");
    expect(line(empty, "現金：")).toBe("現金：");
    expect(line(empty, "ローン金額：")).toBe("ローン金額：");
    expect(line(empty, "追加部材の金額：")).toBe("追加部材の金額：");
  });

  it("PT が未入力なら APPT・CLPT は空欄（@pocket の \"-\" は出さない）", () => {
    const text = build({ pt: "" });
    expect(line(text, "APPT：")).toBe("APPT：");
    expect(line(text, "CLPT：")).toBe("CLPT：");
  });

  it("数字以外が混ざる自由入力は加工しない（単位も付けない）", () => {
    expect(formatContractAmount("一式")).toBe("一式");
    expect(formatContractAmount("50,000円")).toBe("50,000円");
    expect(formatContractAmount("")).toBe("");
    expect(formatContractAmount("-")).toBe("");
    expect(formatContractAmount("50000")).toBe("50,000円");
    expect(formatContractAmount("0")).toBe("0円");
  });
});

describe("★ 単位（値があるときだけ付ける）", () => {
  it("パワコン台数は「台」", () => {
    expect(line(build(), "パワコン台数：")).toBe("パワコン台数：2台");
  });

  it("空欄なら単位も付けない", () => {
    const empty = build({
      powerConCount: "",
      panelCount1: "",
      panelCount2: "",
      panelModel1: "",
      panelModel2: "",
    });
    expect(line(empty, "パワコン台数：")).toBe("パワコン台数：");
    expect(line(empty, "太陽光：")).toBe("太陽光：");
  });

  it("@pocket の「-」でも単位を付けない", () => {
    const dash = build({ powerConCount: "-", panelCount1: "-", panelCount2: "-" });
    expect(line(dash, "パワコン台数：")).toBe("パワコン台数：");
    expect(line(dash, "太陽光：")).toBe("太陽光：（AAA-100 + BBB-200）");
  });

  it("分電盤アンペアの A は @pocket の値のまま（重ねて付けない）", () => {
    expect(line(build(), "分電盤アンペア：")).toBe("分電盤アンペア：60A");
  });
});

describe("実機で出た表記の修正", () => {
  /**
   * 実機（T00003372）で出た本文の指摘箇所をまとめて確認する。
   * 修正前は「10 + 0」「パワコン台数：1」「契約金額：80,000」だった。
   */
  it("★ 単位・0要素の省略・0円がまとめて直っている", () => {
    const text = build(
      {
        panelModel1: "NU-244AT",
        panelModel2: "",
        panelCount1: "10",
        panelCount2: "0",
        powerConCount: "1",
        powerConModel1: "JH-55NF3",
        powerConModel2: "",
        batteryCapacity1: "7.7",
        batteryCapacity2: "0",
        breakerAmps: "50A",
        contractAmount: "80000",
        cashAmount: "80000",
        loanAmount: "0",
        extraPartsAmount: "0",
      },
      { tNumber: "T00003372", batteryLocation: "屋外" },
    );

    expect(line(text, "T番号：")).toBe("T番号：T00003372");
    expect(line(text, "太陽光：")).toBe("太陽光：（NU-244AT）10枚");
    expect(line(text, "パワコン台数：")).toBe("パワコン台数：1台");
    expect(line(text, "パワコン品番：")).toBe("パワコン品番：JH-55NF3");
    expect(line(text, "蓄電池：")).toBe("蓄電池：全負荷、7.7kWh、屋外");
    expect(line(text, "分電盤アンペア：")).toBe("分電盤アンペア：50A");
    expect(line(text, "契約金額：")).toBe("契約金額：80,000円");
    expect(line(text, "現金：")).toBe("現金：80,000円");
    expect(line(text, "ローン金額：")).toBe("ローン金額：0円");
    expect(line(text, "追加部材の金額：")).toBe("追加部材の金額：0円");
  });
});

describe("通知本文の実例", () => {
  it("値が埋まっている場合", () => {
    expect(build()).toBe(
      [
        "【契約速報】",
        "T番号：T-1483",
        "契約日：2026/08/18",
        "AP担当者：西村太郎",
        "APPT：600円",
        "CL担当者：冨田菜摘",
        "CLPT：600円",
        "お客様名：山田太郎",
        "フリガナ：ヤマダタロウ",
        "郵便番号：〒123-4567",
        "設置住所：愛知県名古屋市中区栄1-2-3",
        "契約者電話番号：090-1234-5678",
        "導入経緯：紹介",
        "太陽光：（AAA-100 + BBB-200）12枚 + 6枚",
        "パワコン台数：2台",
        "パワコン品番：PC-1 + PC-2",
        "蓄電池：全負荷、5.6kWh + 5.6kWh、屋内",
        "屋根材：和瓦",
        "屋根材詳細：KAWARA-9",
        "FIT適用有無：FIT",
        "現在の電力会社：中部電力",
        "電気契約プラン名：従量電灯B",
        "化粧カバー：黒,白",
        "分電盤アンペア：60A",
        "支払方法：ローン",
        "信販会社：ジャックス",
        "契約金額：3,500,000円",
        "現金：500,000円",
        "ローン金額：3,000,000円",
        "追加部材：架台",
        "追加部材URL：https://example.test/parts",
        "追加部材の金額：120,000円",
        "創蓄or蓄単or太単：太陽光パネル+蓄電池",
        "補助金：有",
        "事前申請有無：無",
      ].join("\n"),
    );
  });

  it("空が混ざる場合（蓄電池のみ・任意項目が未入力）", () => {
    const text = buildContractNotificationText({
      values: {
        inputStatus: "入力完了",
        contractDate: "2026-09-01",
        apStaff: "西村太郎",
        clStaff: "西村太郎",
        pt: "800",
        customerName: "鈴木花子",
        furigana: "スズキハナコ",
        postalCode: "",
        prefecture: "岐阜県",
        city: "岐阜市",
        address: "",
        phone: "058-000-0000",
        introduction: "",
        panelModel1: "-",
        panelModel2: "-",
        panelCount1: "-",
        panelCount2: "-",
        powerConCount: "1",
        powerConModel1: "PC-1",
        powerConModel2: "-",
        batteryCapacity1: "16.6kWh",
        batteryCapacity2: "-",
        roofMaterial: "",
        roofMaterialModel: "",
        fitType: "非FIT",
        contractPowerCompany: "",
        contractPowerPlan: "",
        cosmeticCover: "無",
        breakerAmps: "60A",
        paymentMethod: "現金",
        creditCompany: "",
        contractAmount: "1980000",
        cashAmount: "1980000",
        loanAmount: "",
        extraPartsName: "",
        extraPartsUrl: "",
        extraPartsAmount: "",
        installationType: "蓄電池のみ",
        subsidy: "無",
        preApplication: "無",
      },
      tNumber: "T-2001",
      batteryLocation: "",
    });

    expect(text).toBe(
      [
        "【契約速報】",
        "T番号：T-2001",
        "契約日：2026/09/01",
        "AP担当者：西村太郎",
        "APPT：0円",
        "CL担当者：西村太郎",
        "CLPT：800円",
        "お客様名：鈴木花子",
        "フリガナ：スズキハナコ",
        "郵便番号：〒",
        "設置住所：岐阜県岐阜市",
        "契約者電話番号：058-000-0000",
        "導入経緯：",
        "太陽光：",
        "パワコン台数：1台",
        "パワコン品番：PC-1",
        "蓄電池：全負荷、16.6kWh",
        "屋根材：",
        "屋根材詳細：",
        "FIT適用有無：非FIT",
        "現在の電力会社：",
        "電気契約プラン名：",
        "化粧カバー：無",
        "分電盤アンペア：60A",
        "支払方法：現金",
        "信販会社：",
        "契約金額：1,980,000円",
        "現金：1,980,000円",
        "ローン金額：",
        "追加部材：",
        "追加部材URL：",
        "追加部材の金額：",
        "創蓄or蓄単or太単：蓄電池のみ",
        "補助金：無",
        "事前申請有無：無",
      ].join("\n"),
    );
  });
});
