import { describe, expect, it } from "vitest";

import { CUSTOMER_DOCUMENT_SPECS } from "@/lib/customer-documents-spec";
import {
  NON_FIT_HIDDEN_DOCUMENT_KEYS,
  shouldShowNonFitHiddenDocuments,
} from "@/lib/customer-info-form/options";
import {
  applyCustomerInfoHiddenDefaultsToValues,
  buildCustomerInfoFormPayload,
  isCustomerInfoFormFieldVisible,
} from "@/lib/customer-info-form/rules";
import {
  CUSTOMER_INFO_FORM_FIELDS,
  CUSTOMER_INFO_FORM_FIELD_MAP,
  INSTALLATION_TYPE_OPTIONS,
} from "@/lib/customer-info-form/schema";
import { findMissingRequiredCustomerInfoFields } from "@/lib/customer-info-form/validate";
import type {
  CustomerInfoFormFieldResolved,
  CustomerInfoFormValues,
} from "@/lib/customer-info-form/types";

/**
 * 条件W：売電方式（FIT or 非FIT）が「非FIT」のとき隠す書類。
 *
 * 対象は7 key（印鑑登録証明書1・委任状3・同意書3）。
 * 「非FIT」を選んだときだけ隠す。未選択（空）は表示する。
 * 隠れているあいだは @pocket を一切触らない（"-" も「不要」も書かない）。
 */

/** 印鑑登録証明書。設置種別の条件は無い */
const SEAL = "sealRegistrationCertificate";
/** 委任状(創蓄)。設置種別は条件T＝太陽光あり */
const PROXY_STORAGE = "powerOfAttorneyStorage";
/** 委任状(変更認定用)。設置種別は条件U＝太陽光なし */
const PROXY_CHANGE = "powerOfAttorneyChangeCert";
/** 委任状(ID・パスワード開示用)。設置種別は条件U */
const PROXY_ID = "powerOfAttorneyIdPassword";
/** 設備認定に関する同意書。設置種別は条件T */
const CONSENT_EQUIPMENT = "equipmentCertConsent";
/** 運転費用年報提出に関する同意書。設置種別は条件T */
const CONSENT_OPERATING = "operatingCostReportConsent";
/** 発電設備の無償使用に関する同意書。設置種別は条件T */
const CONSENT_FREE_USE = "freeUseGenerationConsent";

/** 条件T（太陽光あり）で表示される対象 key */
const SOLAR_ONLY_TARGETS = [
  PROXY_STORAGE,
  CONSENT_EQUIPMENT,
  CONSENT_OPERATING,
  CONSENT_FREE_USE,
];
/** 条件U（太陽光なし）で表示される対象 key */
const NON_SOLAR_TARGETS = [PROXY_CHANGE, PROXY_ID];

/** 太陽光あり（条件T が成立する設置種別） */
const WITH_SOLAR = "太陽光パネル+蓄電池";
/** 太陽光なし（条件U が成立する設置種別） */
const WITHOUT_SOLAR = "蓄電池のみ";

/** @pocket の実物どおりの文字列。1文字も変えないこと */
const NON_FIT = "非FIT";
const FIT = "FIT";

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

/** 書類16項目を必須チェックに掛けて、未入力と判定された key を返す */
function missingDocumentKeys(values: CustomerInfoFormValues): string[] {
  const fields = CUSTOMER_DOCUMENT_SPECS.map((spec) => {
    const def = CUSTOMER_INFO_FORM_FIELD_MAP.get(spec.key);
    if (!def) throw new Error(`schema に無い書類キー: ${spec.key}`);
    return {
      key: def.key,
      label: def.caption,
      type: def.type,
      required: def.required,
    };
  });
  return findMissingRequiredCustomerInfoFields(fields, values).map((f) => f.key);
}

/** 条件W の対象外の書類（残り9項目） */
const OTHER_DOCUMENT_KEYS = CUSTOMER_DOCUMENT_SPECS.map((s) => s.key).filter(
  (k) => !NON_FIT_HIDDEN_DOCUMENT_KEYS.has(k),
);

describe("対象キーの定義（条件W）", () => {
  it("印鑑登録証明書1・委任状3・同意書3 の7項目", () => {
    expect([...NON_FIT_HIDDEN_DOCUMENT_KEYS].sort()).toEqual(
      [
        SEAL,
        PROXY_STORAGE,
        PROXY_CHANGE,
        PROXY_ID,
        CONSENT_EQUIPMENT,
        CONSENT_OPERATING,
        CONSENT_FREE_USE,
      ].sort(),
    );
  });

  it("7項目とも書類16項目に含まれる", () => {
    const all = new Set(CUSTOMER_DOCUMENT_SPECS.map((s) => s.key));
    for (const key of NON_FIT_HIDDEN_DOCUMENT_KEYS) {
      expect(all.has(key), key).toBe(true);
    }
  });

  it("残りは9項目", () => {
    expect(OTHER_DOCUMENT_KEYS).toHaveLength(9);
  });

  /**
   * 見出しは @pocket の列名と完全一致させる必要がある。
   * 書類の見出しは schema と customer-documents-spec の2箇所にあるので、
   * 食い違ったまま気づかない状態にしない
   */
  it("★ 対象7項目の見出しが schema と書類仕様で一致する", () => {
    for (const key of NON_FIT_HIDDEN_DOCUMENT_KEYS) {
      const spec = CUSTOMER_DOCUMENT_SPECS.find((s) => s.key === key);
      const def = CUSTOMER_INFO_FORM_FIELD_MAP.get(key);
      expect(spec?.caption, key).toBe(def?.caption);
      expect((def?.caption ?? "").length, key).toBeGreaterThan(0);
    }
  });

  it("★ 追加した同意書3項目は radio・3択・hiddenValue が「不要」", () => {
    for (const key of [
      CONSENT_EQUIPMENT,
      CONSENT_OPERATING,
      CONSENT_FREE_USE,
    ]) {
      const def = CUSTOMER_INFO_FORM_FIELD_MAP.get(key);
      expect(def?.type, key).toBe("radio");
      expect(def?.options, key).toEqual(["未回収", "回収済み", "不要"]);
      expect(def?.hiddenValue, key).toBe("不要");
    }
  });
});

describe("shouldShowNonFitHiddenDocuments（判定はこの1関数に集約）", () => {
  it("非FIT なら false", () => {
    expect(shouldShowNonFitHiddenDocuments({ fitType: NON_FIT })).toBe(false);
  });

  it("FIT なら true", () => {
    expect(shouldShowNonFitHiddenDocuments({ fitType: FIT })).toBe(true);
  });

  it("未選択（空）なら true", () => {
    expect(shouldShowNonFitHiddenDocuments({ fitType: "" })).toBe(true);
    expect(shouldShowNonFitHiddenDocuments({})).toBe(true);
  });

  it("前後の空白は落として比較する", () => {
    expect(shouldShowNonFitHiddenDocuments({ fitType: " 非FIT " })).toBe(false);
  });

  it("「FIT」は「非FIT」に含まれる文字列だが誤判定しない", () => {
    expect(shouldShowNonFitHiddenDocuments({ fitType: FIT })).toBe(true);
  });
});

describe("表示：非FIT のとき7項目が出ない", () => {
  it("★ 太陽光あり + 非FIT → 対象7項目すべて非表示", () => {
    const values = { installationType: WITH_SOLAR, fitType: NON_FIT };
    for (const key of NON_FIT_HIDDEN_DOCUMENT_KEYS) {
      expect(isCustomerInfoFormFieldVisible(key, values), key).toBe(false);
    }
  });

  it("★ 太陽光なし + 非FIT → 対象7項目すべて非表示", () => {
    const values = { installationType: WITHOUT_SOLAR, fitType: NON_FIT };
    for (const key of NON_FIT_HIDDEN_DOCUMENT_KEYS) {
      expect(isCustomerInfoFormFieldVisible(key, values), key).toBe(false);
    }
  });

  it("★ 非FIT では設置種別4値すべてで7項目とも非表示", () => {
    for (const installationType of INSTALLATION_TYPE_OPTIONS) {
      const values = { installationType, fitType: NON_FIT };
      for (const key of NON_FIT_HIDDEN_DOCUMENT_KEYS) {
        expect(
          isCustomerInfoFormFieldVisible(key, values),
          `${installationType} / ${key}`,
        ).toBe(false);
      }
    }
  });
});

describe("表示：FIT・未選択は従来どおり", () => {
  for (const [label, fitType] of [
    ["FIT", FIT],
    ["未選択", ""],
  ] as const) {
    it(`${label} + 太陽光あり → 条件T の対象と印鑑登録証明書が表示`, () => {
      const values = { installationType: WITH_SOLAR, fitType };
      expect(isCustomerInfoFormFieldVisible(SEAL, values)).toBe(true);
      for (const key of SOLAR_ONLY_TARGETS) {
        expect(isCustomerInfoFormFieldVisible(key, values), key).toBe(true);
      }
    });

    it(`${label} + 太陽光なし → 条件U の対象と印鑑登録証明書が表示`, () => {
      const values = { installationType: WITHOUT_SOLAR, fitType };
      expect(isCustomerInfoFormFieldVisible(SEAL, values)).toBe(true);
      for (const key of NON_SOLAR_TARGETS) {
        expect(isCustomerInfoFormFieldVisible(key, values), key).toBe(true);
      }
    });
  }
});

describe("設置種別による切り替えは変えていない（条件T／条件U）", () => {
  for (const fitType of [FIT, ""]) {
    const label = fitType === "" ? "未選択" : fitType;

    it(`${label}：太陽光なしのとき 条件T の対象は従来どおり非表示`, () => {
      const values = { installationType: WITHOUT_SOLAR, fitType };
      for (const key of SOLAR_ONLY_TARGETS) {
        expect(isCustomerInfoFormFieldVisible(key, values), key).toBe(false);
      }
    });

    it(`${label}：太陽光ありのとき 条件U の対象は従来どおり非表示`, () => {
      const values = { installationType: WITH_SOLAR, fitType };
      for (const key of NON_SOLAR_TARGETS) {
        expect(isCustomerInfoFormFieldVisible(key, values), key).toBe(false);
      }
    });

    it(`${label}：印鑑登録証明書は設置種別に関わらず表示`, () => {
      for (const installationType of INSTALLATION_TYPE_OPTIONS) {
        expect(
          isCustomerInfoFormFieldVisible(SEAL, { installationType, fitType }),
          installationType,
        ).toBe(true);
      }
    });
  }

  it("★ 設置種別で消えた対象は、FIT なら従来どおり「不要」を書く", () => {
    // 条件T の対象は太陽光なしで非表示。FIT なので条件W の保護には入らない
    const noSolar = payloadFor({
      installationType: WITHOUT_SOLAR,
      fitType: FIT,
      ...Object.fromEntries(SOLAR_ONLY_TARGETS.map((k) => [k, ""])),
    });
    for (const key of SOLAR_ONLY_TARGETS) {
      expect(noSolar[key], key).toBe("不要");
    }

    // 条件U の対象は太陽光ありで非表示
    const withSolar = payloadFor({
      installationType: WITH_SOLAR,
      fitType: FIT,
      ...Object.fromEntries(NON_SOLAR_TARGETS.map((k) => [k, ""])),
    });
    for (const key of NON_SOLAR_TARGETS) {
      expect(withSolar[key], key).toBe("不要");
    }
  });
});

describe("必須：非FIT のとき7項目が必須にならない", () => {
  function blank(installationType: string): CustomerInfoFormValues {
    const values: CustomerInfoFormValues = { installationType };
    for (const key of NON_FIT_HIDDEN_DOCUMENT_KEYS) values[key] = "";
    return values;
  }

  it("★ 非FIT なら7項目とも未入力エラーにならない（設置種別4値すべて）", () => {
    for (const installationType of INSTALLATION_TYPE_OPTIONS) {
      const missing = missingDocumentKeys({
        ...blank(installationType),
        fitType: NON_FIT,
      });
      for (const key of NON_FIT_HIDDEN_DOCUMENT_KEYS) {
        expect(missing, `${installationType} / ${key}`).not.toContain(key);
      }
    }
  });

  it("FIT なら従来どおり必須（表示中の項目だけ）", () => {
    const missing = missingDocumentKeys({
      ...blank(WITH_SOLAR),
      fitType: FIT,
    });
    expect(missing).toContain(SEAL);
    for (const key of SOLAR_ONLY_TARGETS) expect(missing).toContain(key);
    // 条件U の2項目は太陽光ありでは非表示なので、元から必須にならない
    for (const key of NON_SOLAR_TARGETS) expect(missing).not.toContain(key);
  });

  it("売電方式が未選択なら従来どおり必須", () => {
    const missing = missingDocumentKeys(blank(WITH_SOLAR));
    expect(missing).toContain(SEAL);
    for (const key of SOLAR_ONLY_TARGETS) expect(missing).toContain(key);
  });
});

describe("保存：非FIT のとき7項目を payload に含めない", () => {
  it("★ 値・設置種別を問わず、対象7項目を1つも送らない", () => {
    for (const installationType of INSTALLATION_TYPE_OPTIONS) {
      for (const raw of ["", "-", "不要", "未回収", "回収済み"]) {
        const values: CustomerInfoFormValues = {
          installationType,
          fitType: NON_FIT,
        };
        for (const key of NON_FIT_HIDDEN_DOCUMENT_KEYS) values[key] = raw;
        const p = payloadFor(values);
        for (const key of NON_FIT_HIDDEN_DOCUMENT_KEYS) {
          expect(p, `${installationType} / ${key} / ${raw}`).not.toHaveProperty(
            key,
          );
        }
      }
    }
  });

  it('★ 値が空でも "-" でも「不要」を書かない（既存値が消えない）', () => {
    const p = payloadFor({
      installationType: WITH_SOLAR,
      fitType: NON_FIT,
      [SEAL]: "",
      [CONSENT_EQUIPMENT]: "-",
      [CONSENT_OPERATING]: "不要",
      [CONSENT_FREE_USE]: "回収済み",
    });
    expect(p).not.toHaveProperty(SEAL);
    expect(p).not.toHaveProperty(CONSENT_EQUIPMENT);
    expect(p).not.toHaveProperty(CONSENT_OPERATING);
    expect(p).not.toHaveProperty(CONSENT_FREE_USE);
  });

  it("FIT なら従来どおり送る", () => {
    const p = payloadFor({
      installationType: WITH_SOLAR,
      fitType: FIT,
      [SEAL]: "回収済み",
      [PROXY_STORAGE]: "未回収",
      [CONSENT_EQUIPMENT]: "回収済み",
      [CONSENT_OPERATING]: "未回収",
      [CONSENT_FREE_USE]: "回収済み",
    });
    expect(p[SEAL]).toBe("回収済み");
    expect(p[PROXY_STORAGE]).toBe("未回収");
    expect(p[CONSENT_EQUIPMENT]).toBe("回収済み");
    expect(p[CONSENT_OPERATING]).toBe("未回収");
    expect(p[CONSENT_FREE_USE]).toBe("回収済み");
  });

  it("売電方式が未選択なら従来どおり送る", () => {
    const p = payloadFor({
      installationType: WITH_SOLAR,
      [SEAL]: "回収済み",
      [CONSENT_EQUIPMENT]: "未回収",
    });
    expect(p[SEAL]).toBe("回収済み");
    expect(p[CONSENT_EQUIPMENT]).toBe("未回収");
  });
});

describe("非表示時の既定値適用でも「不要」で潰さない", () => {
  it("★ 非FIT のあいだは applyCustomerInfoHiddenDefaults が7項目を書き換えない", () => {
    const raws = ["回収済み", "未回収", "回収済み", "", "未回収", "回収済み", ""];
    const before: CustomerInfoFormValues = {
      installationType: WITH_SOLAR,
      fitType: NON_FIT,
    };
    const keys = [...NON_FIT_HIDDEN_DOCUMENT_KEYS];
    keys.forEach((key, i) => {
      before[key] = raws[i] ?? "";
    });

    const after = applyCustomerInfoHiddenDefaultsToValues(before, {
      includeDocumentFields: true,
    });
    for (const key of keys) {
      expect(after[key], key).toBe(before[key]);
    }
  });

  it("FIT なら従来どおり、設置種別で消えた対象に「不要」が入る", () => {
    const after = applyCustomerInfoHiddenDefaultsToValues(
      {
        installationType: WITH_SOLAR,
        fitType: FIT,
        [PROXY_CHANGE]: "",
        [PROXY_ID]: "",
      },
      { includeDocumentFields: true },
    );
    expect(after[PROXY_CHANGE]).toBe("不要");
    expect(after[PROXY_ID]).toBe("不要");
  });
});

describe("残りの書類9項目の挙動が変わらないこと", () => {
  it("★ 表示判定：FIT・非FIT・未選択で結果が変わらない", () => {
    for (const installationType of INSTALLATION_TYPE_OPTIONS) {
      for (const paymentMethod of ["ソーラーローン", "現金一括"]) {
        for (const preApplication of ["", "無", "都道府県"]) {
          const base = { installationType, paymentMethod, preApplication };
          for (const key of OTHER_DOCUMENT_KEYS) {
            const unset = isCustomerInfoFormFieldVisible(key, base);
            expect(
              isCustomerInfoFormFieldVisible(key, { ...base, fitType: FIT }),
              key,
            ).toBe(unset);
            expect(
              isCustomerInfoFormFieldVisible(key, { ...base, fitType: NON_FIT }),
              key,
            ).toBe(unset);
          }
        }
      }
    }
  });

  it("★ 保存：FIT・非FIT で残り9項目の payload が変わらない", () => {
    for (const installationType of INSTALLATION_TYPE_OPTIONS) {
      for (const raw of ["", "未回収", "回収済み"]) {
        const base: CustomerInfoFormValues = {
          installationType,
          paymentMethod: "ソーラーローン",
          preApplication: "都道府県",
        };
        for (const key of OTHER_DOCUMENT_KEYS) base[key] = raw;

        const withFit = payloadFor({ ...base, fitType: FIT });
        const withNonFit = payloadFor({ ...base, fitType: NON_FIT });
        for (const key of OTHER_DOCUMENT_KEYS) {
          expect(
            Object.prototype.hasOwnProperty.call(withNonFit, key),
            key,
          ).toBe(Object.prototype.hasOwnProperty.call(withFit, key));
          expect(withNonFit[key], key).toBe(withFit[key]);
        }
      }
    }
  });
});
