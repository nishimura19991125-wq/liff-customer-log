import { describe, expect, it } from "vitest";

import { CUSTOMER_DOCUMENT_SPECS } from "@/lib/customer-documents-spec";
import {
  SEAL_AND_PROXY_DOCUMENT_KEYS,
  shouldShowSealAndProxyDocuments,
} from "@/lib/customer-info-form/options";
import {
  applyCustomerInfoHiddenDefaultsToValues,
  buildCustomerInfoFormPayload,
  isCustomerInfoFormFieldVisible,
} from "@/lib/customer-info-form/rules";
import {
  CUSTOMER_INFO_FORM_FIELDS,
  CUSTOMER_INFO_FORM_FIELD_MAP,
} from "@/lib/customer-info-form/schema";
import { findMissingRequiredCustomerInfoFields } from "@/lib/customer-info-form/validate";
import type {
  CustomerInfoFormFieldResolved,
  CustomerInfoFormValues,
} from "@/lib/customer-info-form/types";

/**
 * 売電方式（FIT or 非FIT）による 印鑑登録証明書・委任状3項目 の出し分け。
 *
 * 「非FIT」を選んだときだけ隠す。未選択（空）は表示する。
 * 隠れているあいだは @pocket を一切触らない（"-" も「不要」も書かない）。
 */

/** 印鑑登録証明書 */
const SEAL = "sealRegistrationCertificate";
/** 委任状(創蓄)。設置種別は条件T＝太陽光あり */
const PROXY_STORAGE = "powerOfAttorneyStorage";
/** 委任状(変更認定用)。設置種別は条件U＝太陽光なし */
const PROXY_CHANGE = "powerOfAttorneyChangeCert";
/** 委任状(ID・パスワード開示用)。設置種別は条件U */
const PROXY_ID = "powerOfAttorneyIdPassword";

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

/** 対象4項目以外の書類（残り12項目） */
const OTHER_DOCUMENT_KEYS = CUSTOMER_DOCUMENT_SPECS.map((s) => s.key).filter(
  (k) => !SEAL_AND_PROXY_DOCUMENT_KEYS.has(k),
);

describe("対象キーの定義", () => {
  it("印鑑登録証明書と委任状3項目の4つ", () => {
    expect([...SEAL_AND_PROXY_DOCUMENT_KEYS].sort()).toEqual(
      [SEAL, PROXY_STORAGE, PROXY_CHANGE, PROXY_ID].sort(),
    );
  });

  it("4項目とも書類16項目に含まれる", () => {
    const all = new Set(CUSTOMER_DOCUMENT_SPECS.map((s) => s.key));
    for (const key of SEAL_AND_PROXY_DOCUMENT_KEYS) {
      expect(all.has(key)).toBe(true);
    }
  });

  it("残りは12項目", () => {
    expect(OTHER_DOCUMENT_KEYS).toHaveLength(12);
  });
});

describe("shouldShowSealAndProxyDocuments（判定はこの1関数に集約）", () => {
  it("非FIT なら false", () => {
    expect(shouldShowSealAndProxyDocuments({ fitType: NON_FIT })).toBe(false);
  });

  it("FIT なら true", () => {
    expect(shouldShowSealAndProxyDocuments({ fitType: FIT })).toBe(true);
  });

  it("未選択（空）なら true", () => {
    expect(shouldShowSealAndProxyDocuments({ fitType: "" })).toBe(true);
    expect(shouldShowSealAndProxyDocuments({})).toBe(true);
  });

  it("前後の空白は落として比較する", () => {
    expect(shouldShowSealAndProxyDocuments({ fitType: " 非FIT " })).toBe(false);
  });

  it("「FIT」は「非FIT」に含まれる文字列だが誤判定しない", () => {
    expect(shouldShowSealAndProxyDocuments({ fitType: FIT })).toBe(true);
  });
});

describe("表示：非FIT のとき印鑑登録証明書・委任状が出ない", () => {
  it("★ 太陽光あり + 非FIT → 印鑑登録証明書・委任状(創蓄) が非表示", () => {
    const values = { installationType: WITH_SOLAR, fitType: NON_FIT };
    expect(isCustomerInfoFormFieldVisible(SEAL, values)).toBe(false);
    expect(isCustomerInfoFormFieldVisible(PROXY_STORAGE, values)).toBe(false);
  });

  it("★ 太陽光なし + 非FIT → 印鑑登録証明書・委任状(変更認定用/ID) が非表示", () => {
    const values = { installationType: WITHOUT_SOLAR, fitType: NON_FIT };
    expect(isCustomerInfoFormFieldVisible(SEAL, values)).toBe(false);
    expect(isCustomerInfoFormFieldVisible(PROXY_CHANGE, values)).toBe(false);
    expect(isCustomerInfoFormFieldVisible(PROXY_ID, values)).toBe(false);
  });

  it("★ 非FIT では設置種別4値すべてで4項目とも非表示", () => {
    for (const installationType of [
      "太陽光パネル+蓄電池",
      "蓄電池のみ",
      "太陽光パネルのみ",
      "パワコン取替のみ",
    ]) {
      const values = { installationType, fitType: NON_FIT };
      for (const key of SEAL_AND_PROXY_DOCUMENT_KEYS) {
        expect(isCustomerInfoFormFieldVisible(key, values)).toBe(false);
      }
    }
  });
});

describe("表示：FIT・未選択は従来どおり", () => {
  it("FIT + 太陽光あり → 印鑑登録証明書・委任状(創蓄) が表示", () => {
    const values = { installationType: WITH_SOLAR, fitType: FIT };
    expect(isCustomerInfoFormFieldVisible(SEAL, values)).toBe(true);
    expect(isCustomerInfoFormFieldVisible(PROXY_STORAGE, values)).toBe(true);
  });

  it("売電方式が未選択 + 太陽光あり → 従来どおり表示", () => {
    const values = { installationType: WITH_SOLAR };
    expect(isCustomerInfoFormFieldVisible(SEAL, values)).toBe(true);
    expect(isCustomerInfoFormFieldVisible(PROXY_STORAGE, values)).toBe(true);
  });

  it("売電方式が未選択 + 太陽光なし → 従来どおり表示", () => {
    const values = { installationType: WITHOUT_SOLAR };
    expect(isCustomerInfoFormFieldVisible(SEAL, values)).toBe(true);
    expect(isCustomerInfoFormFieldVisible(PROXY_CHANGE, values)).toBe(true);
    expect(isCustomerInfoFormFieldVisible(PROXY_ID, values)).toBe(true);
  });
});

describe("設置種別による切り替えは変えていない（条件T／条件U）", () => {
  /** 売電方式に関係なく、設置種別の条件は従来どおり効く */
  for (const fitType of [FIT, ""]) {
    const label = fitType === "" ? "未選択" : fitType;

    it(`${label}：太陽光なしのとき 委任状(創蓄) は従来どおり非表示`, () => {
      const values = { installationType: WITHOUT_SOLAR, fitType };
      expect(isCustomerInfoFormFieldVisible(PROXY_STORAGE, values)).toBe(false);
    });

    it(`${label}：太陽光ありのとき 委任状(変更認定用/ID) は従来どおり非表示`, () => {
      const values = { installationType: WITH_SOLAR, fitType };
      expect(isCustomerInfoFormFieldVisible(PROXY_CHANGE, values)).toBe(false);
      expect(isCustomerInfoFormFieldVisible(PROXY_ID, values)).toBe(false);
    });

    it(`${label}：印鑑登録証明書は設置種別に関わらず表示`, () => {
      for (const installationType of [WITH_SOLAR, WITHOUT_SOLAR]) {
        expect(
          isCustomerInfoFormFieldVisible(SEAL, { installationType, fitType }),
        ).toBe(true);
      }
    });
  }

  it("★ 太陽光なしのとき、設置種別で消える書類の保存挙動は変わらない（不要を書く）", () => {
    // 委任状(創蓄) は条件T で非表示。FIT なので今回の分岐には入らない
    const p = payloadFor({
      installationType: WITHOUT_SOLAR,
      fitType: FIT,
      [PROXY_STORAGE]: "",
    });
    expect(p[PROXY_STORAGE]).toBe("不要");
  });

  it("★ 太陽光ありのとき、条件U の委任状も従来どおり「不要」を書く", () => {
    const p = payloadFor({
      installationType: WITH_SOLAR,
      fitType: FIT,
      [PROXY_CHANGE]: "",
      [PROXY_ID]: "",
    });
    expect(p[PROXY_CHANGE]).toBe("不要");
    expect(p[PROXY_ID]).toBe("不要");
  });
});

describe("必須：非FIT のとき必須にならない", () => {
  const base: CustomerInfoFormValues = {
    installationType: WITH_SOLAR,
    [SEAL]: "",
    [PROXY_STORAGE]: "",
    [PROXY_CHANGE]: "",
    [PROXY_ID]: "",
  };

  it("★ 非FIT なら4項目とも未入力エラーにならない", () => {
    const missing = missingDocumentKeys({ ...base, fitType: NON_FIT });
    for (const key of SEAL_AND_PROXY_DOCUMENT_KEYS) {
      expect(missing).not.toContain(key);
    }
  });

  it("FIT なら従来どおり必須（表示中の項目だけ）", () => {
    const missing = missingDocumentKeys({ ...base, fitType: FIT });
    expect(missing).toContain(SEAL);
    expect(missing).toContain(PROXY_STORAGE);
    // 条件U の2項目は太陽光ありでは非表示なので、元から必須にならない
    expect(missing).not.toContain(PROXY_CHANGE);
  });

  it("売電方式が未選択なら従来どおり必須", () => {
    const missing = missingDocumentKeys(base);
    expect(missing).toContain(SEAL);
    expect(missing).toContain(PROXY_STORAGE);
  });
});

describe("保存：非FIT のとき payload に含めない（@pocket を触らない）", () => {
  it("★ 太陽光あり + 非FIT → 印鑑登録証明書・委任状(創蓄) を送らない", () => {
    const p = payloadFor({
      installationType: WITH_SOLAR,
      fitType: NON_FIT,
      [SEAL]: "回収済み",
      [PROXY_STORAGE]: "回収済み",
    });
    expect(p).not.toHaveProperty(SEAL);
    expect(p).not.toHaveProperty(PROXY_STORAGE);
  });

  it("★ 太陽光なし + 非FIT → 委任状(変更認定用/ID) を送らない", () => {
    const p = payloadFor({
      installationType: WITHOUT_SOLAR,
      fitType: NON_FIT,
      [PROXY_CHANGE]: "未回収",
      [PROXY_ID]: "回収済み",
    });
    expect(p).not.toHaveProperty(PROXY_CHANGE);
    expect(p).not.toHaveProperty(PROXY_ID);
  });

  it("★ 値が空でも送らない（以前は「不要」が書かれていた）", () => {
    const p = payloadFor({
      installationType: WITH_SOLAR,
      fitType: NON_FIT,
      [SEAL]: "",
      [PROXY_STORAGE]: "",
    });
    expect(p).not.toHaveProperty(SEAL);
    expect(p).not.toHaveProperty(PROXY_STORAGE);
  });

  it('★ 値が "-" でも送らない（"-" は選択肢に無い）', () => {
    const p = payloadFor({
      installationType: WITH_SOLAR,
      fitType: NON_FIT,
      [SEAL]: "-",
      [PROXY_STORAGE]: "-",
    });
    expect(p).not.toHaveProperty(SEAL);
    expect(p).not.toHaveProperty(PROXY_STORAGE);
  });

  it("★ 値が「不要」でも送らない", () => {
    const p = payloadFor({
      installationType: WITH_SOLAR,
      fitType: NON_FIT,
      [SEAL]: "不要",
      [PROXY_STORAGE]: "不要",
    });
    expect(p).not.toHaveProperty(SEAL);
    expect(p).not.toHaveProperty(PROXY_STORAGE);
  });

  it("★ 非FIT のとき、4項目のどこにも \"-\" を書かない", () => {
    for (const installationType of [WITH_SOLAR, WITHOUT_SOLAR]) {
      for (const raw of ["", "-", "不要", "未回収", "回収済み"]) {
        const values: CustomerInfoFormValues = {
          installationType,
          fitType: NON_FIT,
        };
        for (const key of SEAL_AND_PROXY_DOCUMENT_KEYS) values[key] = raw;
        const p = payloadFor(values);
        for (const key of SEAL_AND_PROXY_DOCUMENT_KEYS) {
          expect(p).not.toHaveProperty(key);
        }
      }
    }
  });

  it("FIT なら従来どおり送る", () => {
    const p = payloadFor({
      installationType: WITH_SOLAR,
      fitType: FIT,
      [SEAL]: "回収済み",
      [PROXY_STORAGE]: "未回収",
    });
    expect(p[SEAL]).toBe("回収済み");
    expect(p[PROXY_STORAGE]).toBe("未回収");
  });

  it("売電方式が未選択なら従来どおり送る", () => {
    const p = payloadFor({
      installationType: WITH_SOLAR,
      [SEAL]: "回収済み",
      [PROXY_STORAGE]: "未回収",
    });
    expect(p[SEAL]).toBe("回収済み");
    expect(p[PROXY_STORAGE]).toBe("未回収");
  });
});

describe("非表示時の既定値適用でも「不要」で潰さない", () => {
  it("★ 非FIT のあいだは applyCustomerInfoHiddenDefaults が値を書き換えない", () => {
    const before: CustomerInfoFormValues = {
      installationType: WITH_SOLAR,
      fitType: NON_FIT,
      [SEAL]: "回収済み",
      [PROXY_STORAGE]: "未回収",
      [PROXY_CHANGE]: "回収済み",
      [PROXY_ID]: "",
    };
    const after = applyCustomerInfoHiddenDefaultsToValues(before, {
      includeDocumentFields: true,
    });
    expect(after[SEAL]).toBe("回収済み");
    expect(after[PROXY_STORAGE]).toBe("未回収");
    expect(after[PROXY_CHANGE]).toBe("回収済み");
    expect(after[PROXY_ID]).toBe("");
  });

  it("FIT なら従来どおり、条件U の委任状に「不要」が入る", () => {
    const after = applyCustomerInfoHiddenDefaultsToValues(
      {
        installationType: WITH_SOLAR,
        fitType: FIT,
        [PROXY_CHANGE]: "",
      },
      { includeDocumentFields: true },
    );
    expect(after[PROXY_CHANGE]).toBe("不要");
  });
});

describe("他の書類12項目の挙動が変わらないこと", () => {
  /** 対象4項目を消しても、他の書類の表示判定は売電方式に影響されない */
  it("★ 表示判定：FIT・非FIT・未選択で結果が変わらない", () => {
    for (const installationType of [
      "太陽光パネル+蓄電池",
      "蓄電池のみ",
      "太陽光パネルのみ",
      "パワコン取替のみ",
    ]) {
      for (const paymentMethod of ["ソーラーローン", "現金一括"]) {
        for (const preApplication of ["", "無", "都道府県"]) {
          const base = { installationType, paymentMethod, preApplication };
          for (const key of OTHER_DOCUMENT_KEYS) {
            const withFit = isCustomerInfoFormFieldVisible(key, {
              ...base,
              fitType: FIT,
            });
            const withNonFit = isCustomerInfoFormFieldVisible(key, {
              ...base,
              fitType: NON_FIT,
            });
            const unset = isCustomerInfoFormFieldVisible(key, base);
            expect(withNonFit).toBe(unset);
            expect(withFit).toBe(unset);
          }
        }
      }
    }
  });

  it("★ 保存：FIT・非FIT で他の書類の payload が変わらない", () => {
    for (const installationType of ["太陽光パネル+蓄電池", "蓄電池のみ"]) {
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
          expect(Object.prototype.hasOwnProperty.call(withNonFit, key)).toBe(
            Object.prototype.hasOwnProperty.call(withFit, key),
          );
          expect(withNonFit[key]).toBe(withFit[key]);
        }
      }
    }
  });
});
