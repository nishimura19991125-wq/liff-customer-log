import { describe, expect, it } from "vitest";

import {
  INSTALLATION_TYPES_WITH_WIRING_METHOD,
  shouldShowWiringMethod,
} from "@/lib/customer-info-form/options";
import {
  applyCustomerInfoHiddenDefaultsToValues,
  buildCustomerInfoFormPayload,
  isCustomerInfoFormFieldVisible,
} from "@/lib/customer-info-form/rules";
import {
  CUSTOMER_INFO_FORM_FIELDS,
  INSTALLATION_TYPE_OPTIONS,
} from "@/lib/customer-info-form/schema";
import type {
  CustomerInfoFormFieldResolved,
  CustomerInfoFormValues,
} from "@/lib/customer-info-form/types";
import { isCustomerInfoVisibleFieldValueMissing } from "@/lib/customer-info-form/validate";

/**
 * 配線方式は「表示・必須・保存」の3つを shouldShowWiringMethod だけから導く。
 * 引継ぎ資料のアポキャン事故（表示を消しただけで、画面に出ていない値が
 * 保存時に書き込まれていた）と同じ構造なので、判定を1箇所に固定する。
 */

describe("shouldShowWiringMethod", () => {
  it("「太陽光パネル+蓄電池」で true", () => {
    expect(shouldShowWiringMethod("太陽光パネル+蓄電池")).toBe(true);
  });

  it("「蓄電池のみ」で true", () => {
    expect(shouldShowWiringMethod("蓄電池のみ")).toBe(true);
  });

  it("「太陽光パネルのみ」で false", () => {
    expect(shouldShowWiringMethod("太陽光パネルのみ")).toBe(false);
  });

  it("「パワコン取替のみ」で false", () => {
    expect(shouldShowWiringMethod("パワコン取替のみ")).toBe(false);
  });

  it("選択肢に無い値で false", () => {
    expect(shouldShowWiringMethod("太陽光のみ")).toBe(false);
    expect(shouldShowWiringMethod("蓄電池")).toBe(false);
  });

  it("空文字で false", () => {
    expect(shouldShowWiringMethod("")).toBe(false);
  });

  it("前後に空白があっても判定する（trim する）", () => {
    expect(shouldShowWiringMethod(" 蓄電池のみ")).toBe(true);
    expect(shouldShowWiringMethod("太陽光パネル+蓄電池 ")).toBe(true);
    expect(shouldShowWiringMethod("  ")).toBe(false);
  });

  it("空白だけを落とす（全角化・NFKC 正規化はしない）", () => {
    // 設置種別の他の判定（installationTypeHidesPanelSection 等）と同じ扱い。
    // 全角の＋は @pocket の値と別物なので false のままにする
    expect(shouldShowWiringMethod("太陽光パネル＋蓄電池")).toBe(false);
    expect(shouldShowWiringMethod("蓄電池 のみ")).toBe(false);
  });
});

describe("★ 配線方式を出す設置種別が @pocket の選択肢と一致している", () => {
  it("2つとも設置種別の選択肢に含まれる", () => {
    // 1文字でもズレると、条件が永久に成立せず入力欄が出ない
    for (const v of INSTALLATION_TYPES_WITH_WIRING_METHOD) {
      expect([...INSTALLATION_TYPE_OPTIONS], `設置種別「${v}」`).toContain(v);
    }
  });

  it("設置種別の4種類すべてで判定が定義どおり", () => {
    const shown = INSTALLATION_TYPE_OPTIONS.filter((t) =>
      shouldShowWiringMethod(t),
    );
    expect(shown).toEqual(["太陽光パネル+蓄電池", "蓄電池のみ"]);
  });
});

/**
 * 表示条件と保存条件がズレていないことを固定する。
 * 段階2 時点ではスキーマ（列定義）へ未追加なので、解決済みフィールドを
 * 手で足して検証する。段階3 でスキーマに入れば、この足し込みは空振りする。
 */
function resolvedWithWiringMethod(): CustomerInfoFormFieldResolved[] {
  const resolved: CustomerInfoFormFieldResolved[] = CUSTOMER_INFO_FORM_FIELDS.map(
    (f) => ({
      ...f,
      fieldId: f.liffOnly ? "" : f.key,
      label: f.caption,
      value: "",
    }),
  );
  if (!resolved.some((f) => f.key === "wiringMethod")) {
    resolved.push({
      key: "wiringMethod",
      caption: "配線方式",
      type: "select",
      options: ["全負荷", "特定負荷"],
      fieldId: "wiringMethod",
      label: "配線方式",
      value: "",
    });
  }
  return resolved;
}

const RESOLVED = resolvedWithWiringMethod();

function payloadFor(values: CustomerInfoFormValues): Record<string, unknown> {
  return buildCustomerInfoFormPayload(values, RESOLVED);
}

describe("配線方式: 表示条件と保存条件がズレない", () => {
  it.each([...INSTALLATION_TYPE_OPTIONS])(
    "設置種別「%s」で、表示するときだけ payload に入る",
    (installationType) => {
      const values: CustomerInfoFormValues = {
        installationType,
        wiringMethod: "全負荷",
      };
      const visible = isCustomerInfoFormFieldVisible("wiringMethod", values);
      expect(visible).toBe(shouldShowWiringMethod(installationType));
      expect(Object.prototype.hasOwnProperty.call(payloadFor(values), "wiringMethod")).toBe(
        visible,
      );
    },
  );

  it("表示中は選んだ値をそのまま書き込む", () => {
    expect(
      payloadFor({ installationType: "蓄電池のみ", wiringMethod: "特定負荷" })
        .wiringMethod,
    ).toBe("特定負荷");
    expect(
      payloadFor({
        installationType: "太陽光パネル+蓄電池",
        wiringMethod: "全負荷",
      }).wiringMethod,
    ).toBe("全負荷");
  });

  it("★ 非表示なら送らない（@pocket の既存値を残す）", () => {
    const p = payloadFor({
      installationType: "太陽光パネルのみ",
      wiringMethod: "特定負荷",
    });
    expect(p).not.toHaveProperty("wiringMethod");
  });

  it("★ 非表示かつ値が空でも送らない（- で潰さない）", () => {
    // 既定の動きでは "-" が書き込まれる。選択肢に無い値なので必ず防ぐ
    for (const wiringMethod of ["", "-", "  "]) {
      const p = payloadFor({
        installationType: "パワコン取替のみ",
        wiringMethod,
      });
      expect(p, `値「${wiringMethod}」`).not.toHaveProperty("wiringMethod");
    }
  });

  it("★ 非表示の項目を \"-\" で揃える処理でも配線方式は触らない", () => {
    // ここで "-" が入ると、表示が戻ったときにリストが未選択に見える
    const next = applyCustomerInfoHiddenDefaultsToValues({
      installationType: "太陽光パネルのみ",
      wiringMethod: "特定負荷",
    });
    expect(next.wiringMethod).toBe("特定負荷");
  });

  it("★ 値なしの既存顧客は空のまま（勝手に初期値を入れない）", () => {
    const next = applyCustomerInfoHiddenDefaultsToValues({
      installationType: "蓄電池のみ",
      wiringMethod: "",
    });
    expect(next.wiringMethod).toBe("");
  });
});

describe("配線方式: 必須は表示中のみ", () => {
  const field = { key: "wiringMethod", label: "配線方式", type: "select" as const };

  it("表示中で未入力なら必須エラーになる", () => {
    expect(
      isCustomerInfoVisibleFieldValueMissing(field, {
        installationType: "太陽光パネル+蓄電池",
        wiringMethod: "",
      }),
    ).toBe(true);
  });

  it("表示中で入力済みならエラーにならない", () => {
    expect(
      isCustomerInfoVisibleFieldValueMissing(field, {
        installationType: "太陽光パネル+蓄電池",
        wiringMethod: "全負荷",
      }),
    ).toBe(false);
  });

  it("★ 非表示なら未入力でも必須判定の対象外", () => {
    expect(
      isCustomerInfoVisibleFieldValueMissing(field, {
        installationType: "太陽光パネルのみ",
        wiringMethod: "",
      }),
    ).toBe(false);
  });
});
