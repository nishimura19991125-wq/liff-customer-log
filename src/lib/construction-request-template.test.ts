import { describe, expect, it } from "vitest";

import {
  buildConstructionRequestTemplate,
  CONSTRUCTION_DATE_UNDECIDED,
  CONSTRUCTION_REQUEST_STATUS_DONE,
  constructionWorkTypeLabel,
  formatCustomerNameWithHonorific,
  formatBatteryCapacity,
  formatBatteryCapacityLine,
  formatConstructionRequestDate,
  formatPanelCapacity,
  installationTypesWithoutWorkType,
  shouldShowConstructionRequestPanel,
} from "@/lib/construction-request-template";
import {
  CONSTRUCTION_REQUEST_STATUS_OPTIONS,
} from "@/lib/customer-info-form/options";
import { CUSTOMER_INFO_FORM_FIELD_MAP } from "@/lib/customer-info-form/schema";
import { INSTALLATION_TYPE_OPTIONS } from "@/lib/customer-info-form/schema";
import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";

const FULL = String.fromCharCode(0x3000);

const BASE: CustomerInfoFormValues = {
  customerName: "山田　太郎",
  manufacturer: "ネクストエナジー",
  installationType: "太陽光パネル+蓄電池",
  constructionDate: "2026-09-05",
  prefecture: "東京都",
  city: "世田谷区",
  address: "その先の町名番地",
  panelCapacityKw: "5.775",
  batteryCapacity1: "5.6",
  batteryCapacity2: "",
  roofMaterial: "カラーベスト",
  breakerAmps: "60A",
  pinpointAddress: "https://maps.example.test/xyz",
};

function build(overrides: CustomerInfoFormValues = {}) {
  const result = buildConstructionRequestTemplate({ ...BASE, ...overrides });
  if (!result.ok) throw new Error(`unexpected: ${result.reason}`);
  return result;
}

function lineStartingWith(text: string, prefix: string): string | undefined {
  return text.split("\n").find((l) => l.startsWith(prefix));
}

describe("設置種別 → 工事種別", () => {
  it("4種類すべてに対応がある（網羅漏れなし）", () => {
    expect(installationTypesWithoutWorkType()).toEqual([]);
    expect(INSTALLATION_TYPE_OPTIONS).toHaveLength(4);
  });

  it("それぞれ正しい工事種別になる", () => {
    expect(constructionWorkTypeLabel("太陽光パネル+蓄電池")).toBe("創蓄工事");
    expect(constructionWorkTypeLabel("蓄電池のみ")).toBe("蓄単工事");
    expect(constructionWorkTypeLabel("太陽光パネルのみ")).toBe("太陽光単体工事");
    expect(constructionWorkTypeLabel("パワコン取替のみ")).toBe(
      "パワコン取替工事",
    );
  });

  it("未知・未選択は null（推測で埋めない）", () => {
    expect(constructionWorkTypeLabel("")).toBeNull();
    expect(constructionWorkTypeLabel("エコキュートのみ")).toBeNull();
  });

  it("設置種別が未選択ならテンプレートを作らない", () => {
    const result = buildConstructionRequestTemplate({
      ...BASE,
      installationType: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unknown-installation-type");
  });
});

describe("1行目の【…】", () => {
  it("メーカーと工事種別の間に区切りを入れず、工事種別と日付は全角スペース", () => {
    const { text } = build();
    expect(text.split("\n")[1]).toBe(
      `【ネクストエナジー創蓄工事${FULL}2026/9/5(土)】`,
    );
  });
});

describe("パネル行・蓄電池行の出し分け", () => {
  it("創蓄工事は両方出す", () => {
    const { text } = build({ installationType: "太陽光パネル+蓄電池" });
    expect(lineStartingWith(text, "・パネル：")).toBeDefined();
    expect(lineStartingWith(text, "・蓄電池：")).toBeDefined();
  });

  it("太陽光単体工事はパネルのみ", () => {
    const { text } = build({ installationType: "太陽光パネルのみ" });
    expect(lineStartingWith(text, "・パネル：")).toBeDefined();
    expect(lineStartingWith(text, "・蓄電池：")).toBeUndefined();
  });

  it("蓄単工事は蓄電池のみ", () => {
    const { text } = build({ installationType: "蓄電池のみ" });
    expect(lineStartingWith(text, "・パネル：")).toBeUndefined();
    expect(lineStartingWith(text, "・蓄電池：")).toBeDefined();
  });

  it("パワコン取替工事は両方出さない", () => {
    const { text } = build({ installationType: "パワコン取替のみ" });
    expect(lineStartingWith(text, "・パネル：")).toBeUndefined();
    expect(lineStartingWith(text, "・蓄電池：")).toBeUndefined();
  });
});

describe("蓄電池の表記", () => {
  it("①のみなら1つ", () => {
    expect(formatBatteryCapacityLine("5.6", "")).toBe("5.6kWh");
  });

  it("①と②なら + で連結", () => {
    expect(formatBatteryCapacityLine("5.6", "5.6")).toBe("5.6kWh + 5.6kWh");
  });

  it("単位が既に入っていれば二重に付けない", () => {
    expect(formatBatteryCapacity("5.6kWh")).toBe("5.6kWh");
    expect(formatBatteryCapacity("5.6KWH")).toBe("5.6KWH");
    expect(formatBatteryCapacity("5.6kwh")).toBe("5.6kwh");
  });

  it("空・ダッシュは空文字", () => {
    expect(formatBatteryCapacity("")).toBe("");
    expect(formatBatteryCapacity("-")).toBe("");
    expect(formatBatteryCapacityLine("", "")).toBe("");
  });

  it("②だけ入っていても表示できる", () => {
    expect(formatBatteryCapacityLine("", "5.6")).toBe("5.6kWh");
  });
});

describe("パネル容量の表記", () => {
  it("単位 kW を付ける（見出しは小文字だが表記は kW）", () => {
    expect(formatPanelCapacity("5.775")).toBe("5.775kW");
    expect(formatPanelCapacity("12")).toBe("12kW");
  });

  it("単位が既に入っていれば二重に付けない", () => {
    expect(formatPanelCapacity("5.775kW")).toBe("5.775kW");
    expect(formatPanelCapacity("5.775kw")).toBe("5.775kw");
    expect(formatPanelCapacity("5.775KW")).toBe("5.775KW");
  });

  it("空・ダッシュは空文字（単位を付けない）", () => {
    expect(formatPanelCapacity("")).toBe("");
    expect(formatPanelCapacity("   ")).toBe("");
    expect(formatPanelCapacity("-")).toBe("");
    expect(formatPanelCapacity(undefined)).toBe("");
  });

  it("テンプレートの行に反映される", () => {
    expect(lineStartingWith(build().text, "・パネル：")).toBe(
      "・パネル：5.775kW",
    );
    expect(
      lineStartingWith(build({ panelCapacityKw: "" }).text, "・パネル："),
    ).toBe("・パネル：");
  });
});

describe("施工予定日の整形", () => {
  it("ゼロ埋めせず曜日を付ける", () => {
    expect(formatConstructionRequestDate("2026-09-05")).toBe("2026/9/5(土)");
    expect(formatConstructionRequestDate("2026-10-12")).toBe("2026/10/12(月)");
    expect(formatConstructionRequestDate("2026-01-01")).toBe("2026/1/1(木)");
  });

  it("スラッシュ区切りでも受け付ける", () => {
    expect(formatConstructionRequestDate("2026/09/05")).toBe("2026/9/5(土)");
  });

  it("空・不正な日付は空文字", () => {
    expect(formatConstructionRequestDate("")).toBe("");
    expect(formatConstructionRequestDate("未定")).toBe("");
    expect(formatConstructionRequestDate("2026-02-30")).toBe("");
  });
});

describe("値が空のとき", () => {
  it("行は残して値だけ空にする", () => {
    const { text } = build({
      manufacturer: "",
      panelCapacityKw: "",
      batteryCapacity1: "",
      batteryCapacity2: "",
      roofMaterial: "",
      breakerAmps: "",
      prefecture: "",
      city: "",
      pinpointAddress: "",
      constructionDate: "",
    });
    expect(lineStartingWith(text, "・パネル：")).toBe("・パネル：");
    expect(lineStartingWith(text, "・蓄電池：")).toBe("・蓄電池：");
    expect(lineStartingWith(text, "・屋根材：")).toBe("・屋根材：");
    expect(lineStartingWith(text, "・分電盤：")).toBe("・分電盤：");
    expect(lineStartingWith(text, "住所：")).toBe("住所：");
    expect(text).toContain("📍ピンポイント");
    expect(text).toContain("ご確認よろしくお願いいたします🙇");
  });

  it("お客様名が空なら「様」も付けない", () => {
    expect(formatCustomerNameWithHonorific("")).toBe("");
    expect(formatCustomerNameWithHonorific("   ")).toBe("");
    expect(formatCustomerNameWithHonorific("-")).toBe("");
    expect(formatCustomerNameWithHonorific(undefined)).toBe("");
    expect(
      lineStartingWith(build({ customerName: "" }).text, "お客様名："),
    ).toBe("お客様名：");
  });

  it("お客様名があれば「様」を付ける", () => {
    expect(formatCustomerNameWithHonorific("山田　太郎")).toBe("山田　太郎様");
    expect(lineStartingWith(build().text, "お客様名：")).toBe(
      "お客様名：山田　太郎様",
    );
  });

  it("施工予定日が空なら「工事未定」", () => {
    const { text } = build({ constructionDate: "" });
    expect(text.split("\n")[1]).toBe(
      `【ネクストエナジー創蓄工事${FULL}${CONSTRUCTION_DATE_UNDECIDED}】`,
    );
  });

  it("施工予定日が不正な値でも「工事未定」", () => {
    const { text } = build({ constructionDate: "未定" });
    expect(text.split("\n")[1]).toBe(
      `【ネクストエナジー創蓄工事${FULL}工事未定】`,
    );
  });

  it("@pocket の「-」は空として扱う", () => {
    const { text } = build({ roofMaterial: "-", breakerAmps: "-" });
    expect(lineStartingWith(text, "・屋根材：")).toBe("・屋根材：");
    expect(lineStartingWith(text, "・分電盤：")).toBe("・分電盤：");
  });
});

describe("住所・ピンポイント", () => {
  it("都道府県＋市区郡だけを連結し、町名以降は含めない", () => {
    const { text } = build();
    expect(lineStartingWith(text, "住所：")).toBe("住所：東京都世田谷区");
    expect(text).not.toContain("その先の町名番地");
  });

  it("ピンポイント住所の URL は加工しない", () => {
    const { text } = build();
    expect(text).toContain("https://maps.example.test/xyz");
  });
});

describe("テンプレート全文", () => {
  it("創蓄工事の実例", () => {
    const { text } = build({ batteryCapacity2: "5.6" });
    expect(text).toBe(
      [
        "⭐️新規案件依頼",
        `【ネクストエナジー創蓄工事${FULL}2026/9/5(土)】`,
        "住所：東京都世田谷区",
        "お客様名：山田　太郎様",
        "・メーカー：ネクストエナジー",
        "・パネル：5.775kW",
        "・蓄電池：5.6kWh + 5.6kWh",
        "・屋根材：カラーベスト",
        "・分電盤：60A",
        "",
        "📍ピンポイント",
        "https://maps.example.test/xyz",
        "",
        "ご確認よろしくお願いいたします🙇",
      ].join("\n"),
    );
  });

  it("パワコン取替工事の実例（パネル・蓄電池行なし）", () => {
    const { text } = build({ installationType: "パワコン取替のみ" });
    expect(text).toBe(
      [
        "⭐️新規案件依頼",
        `【ネクストエナジーパワコン取替工事${FULL}2026/9/5(土)】`,
        "住所：東京都世田谷区",
        "お客様名：山田　太郎様",
        "・メーカー：ネクストエナジー",
        "・屋根材：カラーベスト",
        "・分電盤：60A",
        "",
        "📍ピンポイント",
        "https://maps.example.test/xyz",
        "",
        "ご確認よろしくお願いいたします🙇",
      ].join("\n"),
    );
  });
});

describe("施工依頼ステータスによる表示条件", () => {
  it("完了値は「済」", () => {
    expect(CONSTRUCTION_REQUEST_STATUS_DONE).toBe("済");
  });

  it("「済」のときは欄を出さない", () => {
    expect(shouldShowConstructionRequestPanel("済")).toBe(false);
    expect(shouldShowConstructionRequestPanel(" 済 ")).toBe(false);
  });

  it("「済」以外・未設定のときは欄を出す", () => {
    expect(shouldShowConstructionRequestPanel("")).toBe(true);
    expect(shouldShowConstructionRequestPanel(undefined)).toBe(true);
    expect(shouldShowConstructionRequestPanel("未")).toBe(true);
    expect(shouldShowConstructionRequestPanel("-")).toBe(true);
  });
});

describe("空行の位置", () => {
  it.each(INSTALLATION_TYPE_OPTIONS)(
    "%s でも空行が「・分電盤：」の直後と URL の直後に入る",
    (installationType) => {
      const lines = build({ installationType }).text.split("\n");

      const breakerIndex = lines.findIndex((l) => l.startsWith("・分電盤："));
      expect(breakerIndex).toBeGreaterThanOrEqual(0);
      // 分電盤の直後が空行、その次がピンポイントの見出し
      expect(lines[breakerIndex + 1]).toBe("");
      expect(lines[breakerIndex + 2]).toBe("📍ピンポイント");
      // URL の次が空行、その次が結び
      expect(lines[breakerIndex + 3]).toBe("https://maps.example.test/xyz");
      expect(lines[breakerIndex + 4]).toBe("");
      expect(lines[breakerIndex + 5]).toBe(
        "ご確認よろしくお願いいたします🙇",
      );
      // 末尾は結びで終わる（余計な空行を足さない）
      expect(lines).toHaveLength(breakerIndex + 6);
      // 空行はちょうど2つ
      expect(lines.filter((l) => l === "")).toHaveLength(2);
    },
  );

  it("ピンポイント住所が空でも空行の数は変わらない", () => {
    const lines = build({ pinpointAddress: "" }).text.split("\n");
    const breakerIndex = lines.findIndex((l) => l.startsWith("・分電盤："));
    expect(lines[breakerIndex + 1]).toBe("");
    expect(lines[breakerIndex + 2]).toBe("📍ピンポイント");
    // URL 行は空になるが行自体は残る
    expect(lines[breakerIndex + 3]).toBe("");
    expect(lines[breakerIndex + 4]).toBe("");
    expect(lines[breakerIndex + 5]).toBe("ご確認よろしくお願いいたします🙇");
  });
});

describe("施工依頼ステータスの項目定義", () => {
  it("「未」「済」の2択のラジオとして描画される", () => {
    const def = CUSTOMER_INFO_FORM_FIELD_MAP.get("constructionRequestStatus");
    expect(def).toBeDefined();
    expect(def?.type).toBe("radio");
    expect(def?.options).toEqual(["未", "済"]);
    expect(CONSTRUCTION_REQUEST_STATUS_OPTIONS).toEqual(["未", "済"]);
  });

  it("入力欄に出す（hiddenInForm ではない）", () => {
    const def = CUSTOMER_INFO_FORM_FIELD_MAP.get("constructionRequestStatus");
    expect(def?.hiddenInForm).toBeFalsy();
    expect(def?.liffOnly).toBeFalsy();
  });

  it("未入力でも保存できる（required: false）", () => {
    expect(
      CUSTOMER_INFO_FORM_FIELD_MAP.get("constructionRequestStatus")?.required,
    ).toBe(false);
  });

  it("完了値「済」が選択肢に含まれる", () => {
    const def = CUSTOMER_INFO_FORM_FIELD_MAP.get("constructionRequestStatus");
    expect(def?.options).toContain(CONSTRUCTION_REQUEST_STATUS_DONE);
  });
});
