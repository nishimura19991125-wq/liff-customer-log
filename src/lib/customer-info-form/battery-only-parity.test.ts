import { describe, expect, it } from "vitest";

import {
  buildConstructionRequestTemplate,
  constructionWorkTypeLabel,
} from "@/lib/construction-request-template";
import { buildContractNotificationText } from "@/lib/contract-notification";
import { CUSTOMER_DOCUMENT_KEYS } from "@/lib/customer-documents-spec";
import {
  BATTERY_ADDITION_HIDDEN_DOCUMENT_KEYS,
  BATTERY_ONLY_INSTALLATION_TYPES,
  FIT_TYPE_OPTIONS,
  INSTALLATION_TYPES_BATTERY_OR_POWERCON_ONLY,
  INSTALLATION_TYPES_HIDE_BATTERY,
  INSTALLATION_TYPES_HIDE_PANEL,
  INSTALLATION_TYPES_WITH_SOLAR_PANEL,
  INSTALLATION_TYPES_WITH_WIRING_METHOD,
  shouldShowBatteryAdditionHiddenDocuments,
} from "@/lib/customer-info-form/options";
import {
  applyCustomerInfoHiddenDefaultsToValues,
  buildCustomerInfoFormPayload,
  isCustomerInfoFormFieldVisible,
} from "@/lib/customer-info-form/rules";
import {
  CUSTOMER_INFO_FORM_FIELDS,
  INSTALLATION_TYPE_OPTIONS,
  ROOF_MATERIAL_OPTIONS,
} from "@/lib/customer-info-form/schema";
import { findMissingRequiredCustomerInfoFields } from "@/lib/customer-info-form/validate";
import type {
  CustomerInfoFormFieldResolved,
  CustomerInfoFormValues,
} from "@/lib/customer-info-form/types";

/**
 * 「蓄電池増設のみ」は「蓄電池のみ」とまったく同じ扱い。
 *
 * @pocket の設置種別には元からある値だが、アプリ側のハードコードに無く
 * 画面に出ていなかった。値を足すだけでは、設置種別を見ている条件の
 * どこか1つでも足し忘れた時点で**その条件だけ挙動が食い違う**。
 *
 * このファイルは2値の結果が一致することを総当たりで固定する。
 * 片方だけに条件を足したら落ちるので、次に値が増えたときも気づける。
 *
 * ⚠ 対象の定義は BATTERY_ONLY_INSTALLATION_TYPES（options.ts）1箇所だけ。
 *   設置種別を見る集合・対応表はすべてそこから組み立てている。
 */

const BATTERY_ONLY = "蓄電池のみ";
const BATTERY_ADDITION_ONLY = "蓄電池増設のみ";

/** 蓄電池だけではない設置種別（挙動が変わっていないことの確認用） */
const WITH_SOLAR = "太陽光パネル+蓄電池";
const SOLAR_ONLY = "太陽光パネルのみ";
const POWERCON_ONLY = "パワコン取替のみ";

function resolveAll(): CustomerInfoFormFieldResolved[] {
  return CUSTOMER_INFO_FORM_FIELDS.map((f) => ({
    ...f,
    fieldId: f.liffOnly ? "" : f.key,
    label: f.caption,
    value: "",
  }));
}

const RESOLVED = resolveAll();

const VALIDATE_FIELDS = CUSTOMER_INFO_FORM_FIELDS.map((f) => ({
  key: f.key,
  label: f.caption,
  type: f.type,
  required: f.required,
}));

/** 全項目に妥当な値を入れた土台。保存される値まで見比べるため空にしない */
function baseValues(): CustomerInfoFormValues {
  const values: CustomerInfoFormValues = {};
  for (const f of CUSTOMER_INFO_FORM_FIELDS) {
    switch (f.type) {
      case "date":
        values[f.key] = "2026-09-05";
        break;
      case "comma-integer":
        values[f.key] = "10,000";
        break;
      case "decimal-kw":
        values[f.key] = "5.6";
        break;
      case "pt-integer":
        values[f.key] = "5";
        break;
      case "phone":
        values[f.key] = "090-1234-5678";
        break;
      case "postal-code":
        values[f.key] = "123-4567";
        break;
      case "checkbox-group":
      case "select":
      case "radio":
        values[f.key] = f.options?.[0] ?? "テスト値";
        break;
      default:
        values[f.key] = "テスト";
        break;
    }
  }
  return values;
}

/**
 * 設置種別と組み合わさる条件の総当たり。
 *
 * 設置種別だけで決まる条件（配線方式・屋根材）と、設置種別と AND を取る条件
 * （パネル②＝panelCombo・蓄電池容量②＝batteryMulti・屋根材品番＝roofMaterial・
 * 条件W＝fitType）の組み合わせを網羅する。
 */
function scenarios(): CustomerInfoFormValues[] {
  const out: CustomerInfoFormValues[] = [];
  for (const panelCombo of ["有", "無"]) {
    for (const batteryMulti of ["有", "無"]) {
      for (const roofMaterial of ["金属縦平葺", "平板瓦", "その他"]) {
        for (const fitType of [...FIT_TYPE_OPTIONS, ""]) {
          for (const paymentMethod of ["ソーラーローン", "現金一括"]) {
            for (const preApplication of ["無", "都道府県"]) {
              for (const powerConCount of ["1", "2"]) {
                out.push({
                  panelCombo,
                  batteryMulti,
                  roofMaterial,
                  fitType,
                  paymentMethod,
                  preApplication,
                  powerConCount,
                });
              }
            }
          }
        }
      }
    }
  }
  return out;
}

const SCENARIOS = scenarios();

function valuesFor(
  installationType: string,
  scenario: CustomerInfoFormValues,
): CustomerInfoFormValues {
  return { ...baseValues(), ...scenario, installationType };
}

/**
 * 「蓄電池のみ」と「蓄電池増設のみ」で**違ってよい**箇所の一覧。
 *
 * 2値は原則まったく同じ扱いで、設置種別を見る条件は
 * BATTERY_ONLY_INSTALLATION_TYPES（条件U・条件C・条件H・条件M・選択肢の並び）
 * を参照している。違ってよいのはここに挙げた分だけ。
 *
 * ⚠ **3つ目を足すときは、必ずこの一覧にも足すこと。**
 *   件数をテストで固定してあるので、黙って増やすと落ちる。
 *   下の総当たりも、ここに挙げた分だけを比較から外している。
 *   一覧に無い差が生まれれば総当たりが落ちて気づける。
 */
const ALLOWED_DIFFERENCES = [
  {
    id: "workType",
    label: "施工依頼の工事種別（蓄単工事 / 蓄電池増設工事）",
    since: "c928643",
  },
  {
    id: "batteryAdditionHiddenDocuments",
    label: "条件X：蓄電池増設のみで隠す書類7項目",
    since: "条件X の追加",
  },
] as const;

/** 条件X で隠れる7キー。2値の比較から外す唯一の項目群 */
const CONDITION_X_KEYS = [...BATTERY_ADDITION_HIDDEN_DOCUMENT_KEYS];

/** 設置種別の列そのものは値が違って当然なので、比較から外す */
function withoutInstallationType(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== "installationType"),
  );
}

/**
 * 2値の比較対象。設置種別の列と、条件X で隠れる7項目を外す。
 * 外すのは ALLOWED_DIFFERENCES に挙げた分だけ。
 */
function comparable(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(withoutInstallationType(record)).filter(
      ([key]) => !BATTERY_ADDITION_HIDDEN_DOCUMENT_KEYS.has(key),
    ),
  );
}

function label(scenario: CustomerInfoFormValues): string {
  return [
    `panelCombo=${scenario.panelCombo}`,
    `batteryMulti=${scenario.batteryMulti}`,
    `roofMaterial=${scenario.roofMaterial}`,
    `fitType=${scenario.fitType || "未選択"}`,
    `paymentMethod=${scenario.paymentMethod}`,
    `preApplication=${scenario.preApplication}`,
    `powerConCount=${scenario.powerConCount}`,
  ].join(" / ");
}

/**
 * 施工依頼テンプレートの工事種別の行（1行目の「【…】」）。
 * メーカー・工事種別・施工予定日がこの1行に入る。
 */
function workTypeLine(text: string): string {
  const line = text.split("\n").find((l) => l.startsWith("【"));
  if (!line) throw new Error("工事種別の行が見つからない");
  return line;
}

/** 工事種別の行を除いた本文。2値で違ってよいのはこの行だけ */
function withoutWorkTypeLine(text: string): string[] {
  return text.split("\n").filter((l) => !l.startsWith("【"));
}

/** 契約速報の本文。T番号・蓄電池設置箇所は比較に影響しない固定値 */
function notificationText(
  installationType: string,
  scenario: CustomerInfoFormValues,
): string {
  return buildContractNotificationText({
    values: valuesFor(installationType, scenario),
    tNumber: "T-0001",
    batteryLocation: "屋外",
  });
}

describe("選択肢への追加", () => {
  it("★ 「蓄電池増設のみ」が設置種別の選択肢にある（1文字も変えない）", () => {
    expect([...INSTALLATION_TYPE_OPTIONS]).toContain(BATTERY_ADDITION_ONLY);
  });

  it("★ 「蓄電池のみ」の直後に並ぶ", () => {
    const list = [...INSTALLATION_TYPE_OPTIONS];
    const i = list.indexOf(BATTERY_ONLY);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(list[i + 1]).toBe(BATTERY_ADDITION_ONLY);
  });

  it("設置種別は5種類", () => {
    expect([...INSTALLATION_TYPE_OPTIONS]).toEqual([
      WITH_SOLAR,
      BATTERY_ONLY,
      BATTERY_ADDITION_ONLY,
      SOLAR_ONLY,
      POWERCON_ONLY,
    ]);
  });

  it("★ 蓄電池だけの集合はこの2値ちょうど", () => {
    expect([...BATTERY_ONLY_INSTALLATION_TYPES]).toEqual([
      BATTERY_ONLY,
      BATTERY_ADDITION_ONLY,
    ]);
  });

  it("★ 集合の値はすべて設置種別の選択肢にある（ズレると条件が永久に成立しない）", () => {
    for (const t of BATTERY_ONLY_INSTALLATION_TYPES) {
      expect([...INSTALLATION_TYPE_OPTIONS], t).toContain(t);
    }
  });
});

describe("2値で違ってよい箇所", () => {
  /**
   * 一覧が増えていないかを固定する。3つ目の例外を足すときは、
   * ALLOWED_DIFFERENCES に追記したうえでこの件数も直すこと。
   * 一覧に無い差が生まれた場合は、下の総当たりが落ちて気づける。
   */
  it("★ 違ってよいのは2箇所だけ（工事種別・条件X の書類7項目）", () => {
    expect(ALLOWED_DIFFERENCES).toHaveLength(2);
    expect(ALLOWED_DIFFERENCES.map((d) => d.id)).toEqual([
      "workType",
      "batteryAdditionHiddenDocuments",
    ]);
  });

  it("★ 条件X の対象はこの7キーちょうど", () => {
    expect([...CONDITION_X_KEYS].sort()).toEqual(
      [
        "powerCompanyForm",
        "vicinitySketchMap",
        "powerOfAttorneyChangeCert",
        "powerOfAttorneyIdPassword",
        "personalInfoConsent",
        "sealRegistrationCertificate",
        "registryBook",
      ].sort(),
    );
  });

  it("7キーとも書類16項目に含まれる", () => {
    for (const key of CONDITION_X_KEYS) {
      expect(CUSTOMER_DOCUMENT_KEYS.has(key), key).toBe(true);
    }
  });
});

describe("条件X：蓄電池増設のみで書類7項目が隠れる", () => {
  it("★ 増設では7項目が非表示になる", () => {
    for (const scenario of SCENARIOS) {
      const values = valuesFor(BATTERY_ADDITION_ONLY, scenario);
      for (const key of CONDITION_X_KEYS) {
        expect(
          isCustomerInfoFormFieldVisible(key, values),
          `${key} / ${label(scenario)}`,
        ).toBe(false);
      }
    }
  });

  it("★ 増設では7項目が必須から外れる", () => {
    for (const scenario of SCENARIOS) {
      const missing = findMissingRequiredCustomerInfoFields(VALIDATE_FIELDS, {
        ...scenario,
        installationType: BATTERY_ADDITION_ONLY,
      }).map((f) => f.key);
      for (const key of CONDITION_X_KEYS) {
        expect(missing, `${key} / ${label(scenario)}`).not.toContain(key);
      }
    }
  });

  it("★ 増設では7項目の payload が「不要」になる（既存値も上書き）", () => {
    for (const scenario of SCENARIOS) {
      const payload = buildCustomerInfoFormPayload(
        valuesFor(BATTERY_ADDITION_ONLY, scenario),
        RESOLVED,
      );
      for (const key of CONDITION_X_KEYS) {
        expect(payload[key], `${key} / ${label(scenario)}`).toBe("不要");
      }
    }
  });

  it("★ 増設では7項目の画面の値も「不要」になる", () => {
    for (const scenario of SCENARIOS) {
      const shown = applyCustomerInfoHiddenDefaultsToValues(
        valuesFor(BATTERY_ADDITION_ONLY, scenario),
        { includeDocumentFields: true },
      );
      for (const key of CONDITION_X_KEYS) {
        expect(shown[key], `${key} / ${label(scenario)}`).toBe("不要");
      }
    }
  });

  /** 退行の検出。「蓄電池のみ」まで隠れてしまったら落ちる */
  it("★ 蓄電池のみでは7項目が従来どおり（条件T/U/W の範囲でしか隠れない）", () => {
    // 条件T・条件U・条件W が効かない組み合わせを選ぶ
    const base = {
      installationType: BATTERY_ONLY,
      fitType: "FIT",
      paymentMethod: "ソーラーローン",
      preApplication: "都道府県",
    };
    // 蓄電池のみは条件U の対象なので委任状2項目は表示される
    for (const key of [
      "powerCompanyForm",
      "vicinitySketchMap",
      "powerOfAttorneyChangeCert",
      "powerOfAttorneyIdPassword",
      "personalInfoConsent",
      "sealRegistrationCertificate",
      "registryBook",
    ]) {
      expect(isCustomerInfoFormFieldVisible(key, base), key).toBe(true);
    }
  });

  it("★ 蓄電池のみでは7項目の値がそのまま保存される", () => {
    const values = {
      ...baseValues(),
      installationType: BATTERY_ONLY,
      fitType: "FIT",
      paymentMethod: "ソーラーローン",
      preApplication: "都道府県",
      ...Object.fromEntries(CONDITION_X_KEYS.map((k) => [k, "回収済み"])),
    };
    const payload = buildCustomerInfoFormPayload(values, RESOLVED);
    for (const key of CONDITION_X_KEYS) {
      expect(payload[key], key).toBe("回収済み");
    }
  });

  /** 条件U を触っていないことの確認 */
  it("★ パワコン取替のみでは委任状2項目が従来どおり表示・必須", () => {
    const base = {
      installationType: POWERCON_ONLY,
      fitType: "FIT",
      paymentMethod: "ソーラーローン",
      preApplication: "都道府県",
    };
    for (const key of ["powerOfAttorneyChangeCert", "powerOfAttorneyIdPassword"]) {
      expect(isCustomerInfoFormFieldVisible(key, base), key).toBe(true);
    }
    const missing = findMissingRequiredCustomerInfoFields(
      VALIDATE_FIELDS,
      base,
    ).map((f) => f.key);
    expect(missing).toContain("powerOfAttorneyChangeCert");
    expect(missing).toContain("powerOfAttorneyIdPassword");
  });

  it("★ 他の設置種別は条件X の対象外", () => {
    for (const installationType of [
      WITH_SOLAR,
      BATTERY_ONLY,
      SOLAR_ONLY,
      POWERCON_ONLY,
    ]) {
      expect(
        shouldShowBatteryAdditionHiddenDocuments({ installationType }),
        installationType,
      ).toBe(true);
    }
    expect(
      shouldShowBatteryAdditionHiddenDocuments({
        installationType: BATTERY_ADDITION_ONLY,
      }),
    ).toBe(false);
  });
});

describe("表示：条件X の7項目を除けば2値で一致", () => {
  it("★ 全項目 × 条件の総当たりで表示判定が一致する（7項目を除く）", () => {
    for (const scenario of SCENARIOS) {
      const a = valuesFor(BATTERY_ONLY, scenario);
      const b = valuesFor(BATTERY_ADDITION_ONLY, scenario);
      for (const field of CUSTOMER_INFO_FORM_FIELDS) {
        if (BATTERY_ADDITION_HIDDEN_DOCUMENT_KEYS.has(field.key)) continue;
        expect(
          isCustomerInfoFormFieldVisible(field.key, b),
          `${field.key} / ${label(scenario)}`,
        ).toBe(isCustomerInfoFormFieldVisible(field.key, a));
      }
    }
  });

  it("★ 前後の空白付きでも同じ扱い", () => {
    for (const field of CUSTOMER_INFO_FORM_FIELDS) {
      const padded = valuesFor(` ${BATTERY_ADDITION_ONLY} `, {});
      const plain = valuesFor(BATTERY_ADDITION_ONLY, {});
      expect(
        isCustomerInfoFormFieldVisible(field.key, padded),
        field.key,
      ).toBe(isCustomerInfoFormFieldVisible(field.key, plain));
    }
  });
});

describe("必須：条件X の7項目を除けば2値で一致", () => {
  it("★ 総当たりで未入力判定の対象が一致する（7項目を除く）", () => {
    for (const scenario of SCENARIOS) {
      // 空のときに必須が効くかを見るため、土台は使わず空で回す
      const empty = { ...scenario };
      const missingFor = (installationType: string): string[] =>
        findMissingRequiredCustomerInfoFields(VALIDATE_FIELDS, {
          ...empty,
          installationType,
        })
          .map((f) => f.key)
          .filter((k) => !BATTERY_ADDITION_HIDDEN_DOCUMENT_KEYS.has(k));
      expect(missingFor(BATTERY_ADDITION_ONLY), label(scenario)).toEqual(
        missingFor(BATTERY_ONLY),
      );
    }
  });
});

describe("保存：条件X の7項目を除けば2値で一致", () => {
  it("★ 総当たりで payload が一致する（設置種別の列と7項目を除く）", () => {
    for (const scenario of SCENARIOS) {
      const a = buildCustomerInfoFormPayload(
        valuesFor(BATTERY_ONLY, scenario),
        RESOLVED,
      );
      const b = buildCustomerInfoFormPayload(
        valuesFor(BATTERY_ADDITION_ONLY, scenario),
        RESOLVED,
      );
      expect(comparable(b), label(scenario)).toEqual(comparable(a));
    }
  });

  it("★ 設置種別の列にはそれぞれの値が入る", () => {
    for (const t of BATTERY_ONLY_INSTALLATION_TYPES) {
      const payload = buildCustomerInfoFormPayload(valuesFor(t, {}), RESOLVED);
      expect(payload.installationType, t).toBe(t);
    }
  });

  it("★ 空のときも payload が一致する（7項目を除く）", () => {
    for (const scenario of SCENARIOS) {
      const a = buildCustomerInfoFormPayload(
        { ...scenario, installationType: BATTERY_ONLY },
        RESOLVED,
      );
      const b = buildCustomerInfoFormPayload(
        { ...scenario, installationType: BATTERY_ADDITION_ONLY },
        RESOLVED,
      );
      expect(comparable(b), label(scenario)).toEqual(comparable(a));
    }
  });
});

describe("画面の値（非表示時の既定値）：条件X の7項目を除けば2値で一致", () => {
  for (const includeDocumentFields of [true, false]) {
    it(`★ includeDocumentFields=${includeDocumentFields} で結果が一致する（7項目を除く）`, () => {
      for (const scenario of SCENARIOS) {
        const a = applyCustomerInfoHiddenDefaultsToValues(
          valuesFor(BATTERY_ONLY, scenario),
          { includeDocumentFields },
        );
        const b = applyCustomerInfoHiddenDefaultsToValues(
          valuesFor(BATTERY_ADDITION_ONLY, scenario),
          { includeDocumentFields },
        );
        expect(comparable(b), label(scenario)).toEqual(comparable(a));
      }
    });
  }
});

describe("施工依頼テンプレート：工事種別の行だけが違う", () => {
  /**
   * 工事種別だけは2値で表記が違う（集合から展開していない唯一の箇所）。
   * 施工業者はテンプレート1行目で工事の内容を読むため、増設を
   * 「蓄単工事」にまとめると別の工事として伝わらない。
   *
   * ここ以外は「蓄電池のみ」とまったく同じ。契約速報で
   * 「設置種別の行だけが違う」としているのと同じ作法で、
   * 工事種別の行を外した残りが一致することを固定する。
   */
  it("★ 蓄電池のみ→蓄単工事 / 蓄電池増設のみ→蓄電池増設工事", () => {
    expect(constructionWorkTypeLabel(BATTERY_ONLY)).toBe("蓄単工事");
    expect(constructionWorkTypeLabel(BATTERY_ADDITION_ONLY)).toBe(
      "蓄電池増設工事",
    );
  });

  it("★ 2値の工事種別が違う（まとめて同じ表記に戻したら落ちる）", () => {
    expect(constructionWorkTypeLabel(BATTERY_ADDITION_ONLY)).not.toBe(
      constructionWorkTypeLabel(BATTERY_ONLY),
    );
  });

  it("★ 工事種別の行を除けば本文が完全に一致する", () => {
    for (const scenario of SCENARIOS) {
      const a = buildConstructionRequestTemplate(
        valuesFor(BATTERY_ONLY, scenario),
      );
      const b = buildConstructionRequestTemplate(
        valuesFor(BATTERY_ADDITION_ONLY, scenario),
      );
      expect(a.ok, label(scenario)).toBe(true);
      expect(b.ok, label(scenario)).toBe(true);
      if (!a.ok || !b.ok) continue;

      expect(withoutWorkTypeLine(b.text), label(scenario)).toEqual(
        withoutWorkTypeLine(a.text),
      );
    }
  });

  it("★ 違うのは工事種別の行だけで、そこは工事種別しか変わらない", () => {
    const a = buildConstructionRequestTemplate(valuesFor(BATTERY_ONLY, {}));
    const b = buildConstructionRequestTemplate(
      valuesFor(BATTERY_ADDITION_ONLY, {}),
    );
    if (!a.ok || !b.ok) throw new Error("テンプレートを作れない");

    expect(workTypeLine(a.text)).toContain("蓄単工事");
    expect(workTypeLine(b.text)).toContain("蓄電池増設工事");
    // 工事種別の部分だけを入れ替えれば同じ行になる
    expect(workTypeLine(b.text).replace("蓄電池増設工事", "蓄単工事")).toBe(
      workTypeLine(a.text),
    );
  });

  it("★ result.workType もそれぞれの表記になる", () => {
    const a = buildConstructionRequestTemplate(valuesFor(BATTERY_ONLY, {}));
    const b = buildConstructionRequestTemplate(
      valuesFor(BATTERY_ADDITION_ONLY, {}),
    );
    if (!a.ok || !b.ok) throw new Error("テンプレートを作れない");
    expect(a.workType).toBe("蓄単工事");
    expect(b.workType).toBe("蓄電池増設工事");
  });

  it("★ 未知の設置種別として弾かれない", () => {
    for (const t of BATTERY_ONLY_INSTALLATION_TYPES) {
      const result = buildConstructionRequestTemplate(valuesFor(t, {}));
      expect(result.ok, t).toBe(true);
    }
  });

  it("パネル行は出ず、蓄電池行は出る（蓄電池のみと同じ）", () => {
    for (const t of BATTERY_ONLY_INSTALLATION_TYPES) {
      const result = buildConstructionRequestTemplate(valuesFor(t, {}));
      if (!result.ok) throw new Error(`テンプレートを作れない: ${t}`);
      const lines = result.text.split("\n");
      expect(lines.some((l) => l.startsWith("・パネル：")), t).toBe(false);
      expect(lines.some((l) => l.startsWith("・蓄電池：")), t).toBe(true);
    }
  });
});

describe("通知の本文：設置種別の行だけが違う", () => {
  it("★ 「創蓄or蓄単or太単」の行以外は完全に一致する", () => {
    for (const scenario of SCENARIOS.slice(0, 24)) {
      const a = notificationText(BATTERY_ONLY, scenario)
        .split("\n")
        .filter((l) => !l.startsWith("創蓄or蓄単or太単："));
      const b = notificationText(BATTERY_ADDITION_ONLY, scenario)
        .split("\n")
        .filter((l) => !l.startsWith("創蓄or蓄単or太単："));
      expect(b, label(scenario)).toEqual(a);
    }
  });

  it("設置種別の行は入力された値をそのまま出す", () => {
    for (const t of BATTERY_ONLY_INSTALLATION_TYPES) {
      const text = notificationText(t, {});
      expect(text, t).toContain(`創蓄or蓄単or太単：${t}`);
    }
  });
});

describe("設置種別を見ている集合すべてで扱いが同じ", () => {
  /**
   * 集合を1つずつ確かめる。総当たりの表示判定でも落ちるが、
   * どの集合で食い違ったのかはこちらのほうが分かりやすい。
   */
  const SETS = [
    ["INSTALLATION_TYPES_WITH_SOLAR_PANEL", INSTALLATION_TYPES_WITH_SOLAR_PANEL],
    [
      "INSTALLATION_TYPES_BATTERY_OR_POWERCON_ONLY",
      INSTALLATION_TYPES_BATTERY_OR_POWERCON_ONLY,
    ],
    ["INSTALLATION_TYPES_HIDE_PANEL", INSTALLATION_TYPES_HIDE_PANEL],
    ["INSTALLATION_TYPES_HIDE_BATTERY", INSTALLATION_TYPES_HIDE_BATTERY],
    [
      "INSTALLATION_TYPES_WITH_WIRING_METHOD",
      INSTALLATION_TYPES_WITH_WIRING_METHOD,
    ],
  ] as const;

  it("★ どの集合でも2値の所属が一致する", () => {
    for (const [name, set] of SETS) {
      expect(set.has(BATTERY_ADDITION_ONLY), name).toBe(
        set.has(BATTERY_ONLY),
      );
    }
  });
});

describe("他の設置種別の挙動が変わっていないこと", () => {
  /** 設置種別ごとの所属を表で固定する。うっかり他の値を触ったら落ちる */
  const MEMBERSHIP: ReadonlyArray<
    readonly [string, boolean, boolean, boolean, boolean, boolean]
  > = [
    // 設置種別        太陽光あり 蓄電池/パワコンのみ パネル非表示 蓄電池非表示 配線方式
    [WITH_SOLAR, true, false, false, false, true],
    [BATTERY_ONLY, false, true, true, false, true],
    [BATTERY_ADDITION_ONLY, false, true, true, false, true],
    [SOLAR_ONLY, true, false, false, true, false],
    [POWERCON_ONLY, false, true, true, true, false],
  ];

  it("★ 5種類すべての所属が表どおり", () => {
    for (const [
      type,
      withSolar,
      batteryOrPowercon,
      hidePanel,
      hideBattery,
      wiring,
    ] of MEMBERSHIP) {
      expect(INSTALLATION_TYPES_WITH_SOLAR_PANEL.has(type), type).toBe(
        withSolar,
      );
      expect(
        INSTALLATION_TYPES_BATTERY_OR_POWERCON_ONLY.has(type),
        type,
      ).toBe(batteryOrPowercon);
      expect(INSTALLATION_TYPES_HIDE_PANEL.has(type), type).toBe(hidePanel);
      expect(INSTALLATION_TYPES_HIDE_BATTERY.has(type), type).toBe(hideBattery);
      expect(INSTALLATION_TYPES_WITH_WIRING_METHOD.has(type), type).toBe(
        wiring,
      );
    }
  });

  it("★ 「蓄電池増設のみ」を足しても他の4種類の表示判定は変わらない", () => {
    // 期待値は設置種別ごとに書き下す。集合を直しただけでは通らない形にする
    const EXPECTED_WIRING: ReadonlyArray<readonly [string, boolean]> = [
      [WITH_SOLAR, true],
      [SOLAR_ONLY, false],
      [POWERCON_ONLY, false],
    ];
    for (const [type, expected] of EXPECTED_WIRING) {
      expect(
        isCustomerInfoFormFieldVisible("wiringMethod", {
          installationType: type,
        }),
        type,
      ).toBe(expected);
    }

    // 屋根材：太陽光あり・太陽光のみは表示、パワコン取替のみは非表示
    expect(
      isCustomerInfoFormFieldVisible("roofMaterial", {
        installationType: WITH_SOLAR,
      }),
    ).toBe(true);
    expect(
      isCustomerInfoFormFieldVisible("roofMaterial", {
        installationType: SOLAR_ONLY,
      }),
    ).toBe(true);
    expect(
      isCustomerInfoFormFieldVisible("roofMaterial", {
        installationType: POWERCON_ONLY,
      }),
    ).toBe(false);
  });

  it("★ 太陽光ありの設置種別に「蓄電池増設のみ」が混ざっていない", () => {
    expect(INSTALLATION_TYPES_WITH_SOLAR_PANEL.has(BATTERY_ADDITION_ONLY)).toBe(
      false,
    );
    expect(INSTALLATION_TYPES_HIDE_BATTERY.has(BATTERY_ADDITION_ONLY)).toBe(
      false,
    );
  });
});

describe("屋根材品番（設置種別と屋根材の AND）", () => {
  it("★ 2値とも屋根材に関係なく非表示（屋根材そのものが出ないため）", () => {
    for (const roofMaterial of ROOF_MATERIAL_OPTIONS) {
      for (const t of BATTERY_ONLY_INSTALLATION_TYPES) {
        expect(
          isCustomerInfoFormFieldVisible("roofMaterialModel", {
            installationType: t,
            roofMaterial,
          }),
          `${t} / ${roofMaterial}`,
        ).toBe(false);
      }
    }
  });
});
