import { describe, expect, it } from "vitest";

import {
  CUSTOMER_DOCUMENT_KEYS,
  CUSTOMER_DOCUMENT_SPECS,
} from "@/lib/customer-documents-spec";
import {
  DOCUMENT_RADIO_HIDDEN_VALUE,
  FIT_TYPE_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  REFERRAL_SOURCE_FIELD_KEYS,
  SUBSIDY_OR_PREAPPLICATION_OPTIONS,
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
import type {
  CustomerInfoFormFieldResolved,
  CustomerInfoFormValues,
} from "@/lib/customer-info-form/types";

/**
 * 書類16項目は、非表示になったら必ず「不要」を書く。
 *
 * 以前は経路によって挙動が分かれていた。
 *   - 設置種別などで消えたとき  → hiddenValue（項目によっては "-"）
 *   - 非FIT（条件W）で消えたとき → 何も書かない
 *   - 値が残っているとき         → 何も書かない
 * "-" は16項目どの選択肢にも無いので、入ると画面のラジオは未選択に見えるのに
 * 値だけが残る。書かない経路があると、画面の値と @pocket の値が食い違う。
 *
 * いまはどの経路でも「不要」に統一し、既存値も上書きする。
 */

const UNNECESSARY = "不要";
const DASH = "-";

/** @pocket の実物どおりの文字列 */
const NON_FIT = "非FIT";

const DOCUMENT_KEYS = CUSTOMER_DOCUMENT_SPECS.map((s) => s.key);

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

/**
 * 書類の表示条件を動かす4つのキーの総当たり。
 * DOCUMENT_VISIBILITY_TRIGGER_KEYS と同じ4つ。
 */
function everyVisibilityCombination(): CustomerInfoFormValues[] {
  const out: CustomerInfoFormValues[] = [];
  for (const installationType of INSTALLATION_TYPE_OPTIONS) {
    for (const paymentMethod of PAYMENT_METHOD_OPTIONS) {
      for (const preApplication of SUBSIDY_OR_PREAPPLICATION_OPTIONS) {
        for (const fitType of [...FIT_TYPE_OPTIONS, ""]) {
          out.push({
            installationType,
            paymentMethod,
            preApplication,
            fitType,
          });
        }
      }
    }
  }
  return out;
}

const COMBINATIONS = everyVisibilityCombination();

/** 書類16項目に入れてみる値（空・既定値・"-"・実データ） */
const RAW_VALUES = ["", UNNECESSARY, DASH, "未回収", "回収済み", "作成済み"];

describe("前提：16項目すべてが「不要」を選べる", () => {
  it("★ 16項目すべての選択肢に「不要」がある", () => {
    expect(DOCUMENT_KEYS).toHaveLength(16);
    for (const key of DOCUMENT_KEYS) {
      const def = CUSTOMER_INFO_FORM_FIELD_MAP.get(key);
      expect(def, key).toBeDefined();
      expect(def?.options ?? [], key).toContain(UNNECESSARY);
    }
  });

  it("★ 16項目すべての hiddenValue が「不要」（ダッシュに落ちる項目が無い）", () => {
    for (const key of DOCUMENT_KEYS) {
      const def = CUSTOMER_INFO_FORM_FIELD_MAP.get(key);
      expect(def?.hiddenValue, key).toBe(DOCUMENT_RADIO_HIDDEN_VALUE);
    }
    expect(DOCUMENT_RADIO_HIDDEN_VALUE).toBe(UNNECESSARY);
  });

  it("16項目とも radio（選択式なのでダッシュを入れてはいけない）", () => {
    for (const key of DOCUMENT_KEYS) {
      expect(CUSTOMER_INFO_FORM_FIELD_MAP.get(key)?.type, key).toBe("radio");
    }
  });
});

describe("保存：非表示なら経路を問わず「不要」", () => {
  it("★ 表示条件の総当たりで、非表示の書類には必ず「不要」が入る", () => {
    for (const base of COMBINATIONS) {
      for (const raw of RAW_VALUES) {
        const values: CustomerInfoFormValues = { ...base };
        for (const key of DOCUMENT_KEYS) values[key] = raw;
        const payload = payloadFor(values);

        for (const key of DOCUMENT_KEYS) {
          if (isCustomerInfoFormFieldVisible(key, values)) continue;
          const where = `${base.installationType}/${base.paymentMethod}/${base.preApplication}/${base.fitType || "未選択"}/${key}/${raw || "空"}`;
          expect(payload[key], where).toBe(UNNECESSARY);
        }
      }
    }
  });

  it("★ どの組み合わせでも書類にダッシュは書かれない", () => {
    for (const base of COMBINATIONS) {
      for (const raw of RAW_VALUES) {
        const values: CustomerInfoFormValues = { ...base };
        for (const key of DOCUMENT_KEYS) values[key] = raw;
        const payload = payloadFor(values);
        for (const key of DOCUMENT_KEYS) {
          expect(payload[key], `${key}/${raw || "空"}`).not.toBe(DASH);
        }
      }
    }
  });

  it("★ 非FIT の経路（条件W の7項目）で「不要」になる", () => {
    const nonFit: CustomerInfoFormValues = {
      installationType: "太陽光パネル+蓄電池",
      paymentMethod: "ソーラーローン",
      preApplication: "都道府県",
      fitType: NON_FIT,
    };
    for (const key of DOCUMENT_KEYS) nonFit[key] = "回収済み";
    const payload = payloadFor(nonFit);

    for (const key of DOCUMENT_KEYS) {
      if (isCustomerInfoFormFieldVisible(key, nonFit)) continue;
      expect(payload[key], key).toBe(UNNECESSARY);
    }
    // 条件W だけで消える印鑑登録証明書が代表例
    expect(payload.sealRegistrationCertificate).toBe(UNNECESSARY);
  });

  it("★ 設置種別の経路（太陽光なし）で「不要」になる", () => {
    const noSolar: CustomerInfoFormValues = {
      installationType: "パワコン取替のみ",
      paymentMethod: "現金一括",
      preApplication: "無",
      fitType: "FIT",
    };
    for (const key of DOCUMENT_KEYS) noSolar[key] = "回収済み";
    const payload = payloadFor(noSolar);

    // 太陽光ありでだけ出る書類（条件T）
    for (const key of [
      "feedInBankAccountForm",
      "powerOfAttorneyStorage",
      "equipmentCertConsent",
      "operatingCostReportConsent",
      "freeUseGenerationConsent",
    ]) {
      expect(isCustomerInfoFormFieldVisible(key, noSolar), key).toBe(false);
      expect(payload[key], key).toBe(UNNECESSARY);
    }
  });

  it("★ 既存値（回収済み）が入っていても上書きする", () => {
    // FIT で「回収済み」だった顧客を非FIT に変える
    const values: CustomerInfoFormValues = {
      installationType: "太陽光パネル+蓄電池",
      fitType: NON_FIT,
      sealRegistrationCertificate: "回収済み",
      equipmentCertConsent: "回収済み",
    };
    const payload = payloadFor(values);
    expect(payload.sealRegistrationCertificate).toBe(UNNECESSARY);
    expect(payload.equipmentCertConsent).toBe(UNNECESSARY);
  });
});

describe("画面の値も「不要」に揃う", () => {
  it("★ 総当たりで、非表示の書類は画面の値も payload も「不要」で一致する", () => {
    for (const base of COMBINATIONS) {
      const values: CustomerInfoFormValues = { ...base };
      for (const key of DOCUMENT_KEYS) values[key] = "回収済み";

      const shown = applyCustomerInfoHiddenDefaultsToValues(values, {
        includeDocumentFields: true,
      });
      const payload = payloadFor(values);

      for (const key of DOCUMENT_KEYS) {
        if (isCustomerInfoFormFieldVisible(key, values)) continue;
        const where = `${base.installationType}/${base.fitType || "未選択"}/${key}`;
        expect(shown[key], where).toBe(UNNECESSARY);
        expect(payload[key], where).toBe(UNNECESSARY);
      }
    }
  });

  it("★ 非FIT に変えると画面の7項目が「不要」になる", () => {
    const after = applyCustomerInfoHiddenDefaultsToValues(
      {
        installationType: "太陽光パネル+蓄電池",
        fitType: NON_FIT,
        sealRegistrationCertificate: "回収済み",
        powerOfAttorneyStorage: "未回収",
        equipmentCertConsent: "",
      },
      { includeDocumentFields: true },
    );
    expect(after.sealRegistrationCertificate).toBe(UNNECESSARY);
    expect(after.powerOfAttorneyStorage).toBe(UNNECESSARY);
    expect(after.equipmentCertConsent).toBe(UNNECESSARY);
  });

  it("★ 画面の値にもダッシュは入らない", () => {
    for (const base of COMBINATIONS) {
      const values: CustomerInfoFormValues = { ...base };
      for (const key of DOCUMENT_KEYS) values[key] = "";
      const shown = applyCustomerInfoHiddenDefaultsToValues(values, {
        includeDocumentFields: true,
      });
      for (const key of DOCUMENT_KEYS) {
        expect(shown[key], key).not.toBe(DASH);
      }
    }
  });

  it("includeDocumentFields=false なら書類に触れない（タスクG-2 のまま）", () => {
    const values: CustomerInfoFormValues = {
      installationType: "パワコン取替のみ",
      fitType: NON_FIT,
      equipmentCertConsent: "回収済み",
    };
    const after = applyCustomerInfoHiddenDefaultsToValues(values, {
      includeDocumentFields: false,
    });
    expect(after.equipmentCertConsent).toBe("回収済み");
  });
});

describe("表示中は従来どおり保存できる", () => {
  it("★ 表示中の書類は選んだ値がそのまま payload に入る", () => {
    for (const base of COMBINATIONS) {
      const values: CustomerInfoFormValues = { ...base };
      for (const key of DOCUMENT_KEYS) values[key] = "回収済み";
      const payload = payloadFor(values);

      for (const key of DOCUMENT_KEYS) {
        if (!isCustomerInfoFormFieldVisible(key, values)) continue;
        const where = `${base.installationType}/${base.fitType || "未選択"}/${key}`;
        expect(payload[key], where).toBe("回収済み");
      }
    }
  });

  it("表示中に「不要」を選べば「不要」が入る（人の選択を変えない）", () => {
    const values: CustomerInfoFormValues = {
      installationType: "太陽光パネル+蓄電池",
      fitType: "FIT",
      salesConstructionContract: UNNECESSARY,
    };
    expect(
      isCustomerInfoFormFieldVisible("salesConstructionContract", values),
    ).toBe(true);
    expect(payloadFor(values).salesConstructionContract).toBe(UNNECESSARY);
  });

  it("表示中に空なら空文字（従来どおり）", () => {
    const values: CustomerInfoFormValues = {
      installationType: "太陽光パネル+蓄電池",
      fitType: "FIT",
      salesConstructionContract: "",
    };
    expect(payloadFor(values).salesConstructionContract).toBe("");
  });
});

describe("紹介元・紹介手数料は変えていない（条件A）", () => {
  it("★ 条件A が外れているあいだは payload に含めない", () => {
    for (const introduction of ["ダイレクト", "HP", "SNS", ""]) {
      const payload = payloadFor({
        introduction,
        referralSource: "A商事",
        referralFee: "50,000",
      });
      for (const key of REFERRAL_SOURCE_FIELD_KEYS) {
        expect(payload, `${introduction || "未選択"}/${key}`).not.toHaveProperty(
          key,
        );
      }
    }
  });

  it("★ 非表示でも画面の値を「不要」で潰さない（書類ではない）", () => {
    const after = applyCustomerInfoHiddenDefaultsToValues({
      introduction: "ダイレクト",
      referralSource: "A商事",
      referralFee: "50,000",
    });
    expect(after.referralSource).toBe("A商事");
    expect(after.referralFee).toBe("50,000");
  });

  it("条件A が成立していれば従来どおり送る", () => {
    const payload = payloadFor({
      introduction: "お客様紹介",
      referralSource: "A商事",
      referralFee: "50,000",
    });
    expect(payload.referralSource).toBe("A商事");
    expect(payload.referralFee).toBe("50000");
  });

  it("紹介元・紹介手数料は書類16項目ではない", () => {
    for (const key of REFERRAL_SOURCE_FIELD_KEYS) {
      expect(CUSTOMER_DOCUMENT_KEYS.has(key), key).toBe(false);
    }
  });
});
