import { describe, expect, it } from "vitest";

import {
  DOCUMENT_VISIBILITY_TRIGGER_KEYS,
  documentPendingValue,
  forgetDocumentAutoFilled,
  reconcileDocumentHiddenDefaults,
} from "@/lib/customer-info-form/document-hidden-tracking";
import { applyCustomerInfoHiddenDefaultsToValues } from "@/lib/customer-info-form/rules";
import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";

/**
 * タスクGの再現手順を固定する。
 *
 * 症状: 非表示中に書かれた「不要」が、表示に戻っても戻らず保存され、
 *       isDocumentStatusAlert のアラート集合に無いため「書類不足」から漏れていた。
 */

/** 画面の handleFieldChange と同じ順序で1回分の変更を適用する */
function changeField(
  values: CustomerInfoFormValues,
  autoFilled: ReadonlySet<string>,
  key: string,
  value: string,
): { values: CustomerInfoFormValues; autoFilled: Set<string> } {
  let next: CustomerInfoFormValues = { ...values, [key]: value };
  let nextAutoFilled = new Set(autoFilled);

  const isDocumentTrigger = DOCUMENT_VISIBILITY_TRIGGER_KEYS.has(key);
  const before = next;
  next = applyCustomerInfoHiddenDefaultsToValues(next, {
    includeDocumentFields: isDocumentTrigger,
  });
  if (isDocumentTrigger) {
    const reconciled = reconcileDocumentHiddenDefaults({
      before,
      after: next,
      autoFilled: nextAutoFilled,
    });
    next = reconciled.values;
    nextAutoFilled = reconciled.autoFilled;
  }
  nextAutoFilled = forgetDocumentAutoFilled(nextAutoFilled, key);
  return { values: next, autoFilled: nextAutoFilled };
}

/** 設置種別=太陽光系のときだけ表示される書類 */
const SOLAR_DOCS = [
  "feedInBankAccountForm",
  "powerOfAttorneyStorage",
  "equipmentCertConsent",
  "operatingCostReportConsent",
  "freeUseGenerationConsent",
] as const;

describe("再現手順: 設置種別が空のまま支払方法を選ぶ", () => {
  it("① 太陽光系の書類に「不要」が入る", () => {
    const step1 = changeField({}, new Set(), "paymentMethod", "ソーラーローン");
    for (const key of SOLAR_DOCS) {
      expect(step1.values[key]).toBe("不要");
      expect(step1.autoFilled.has(key)).toBe(true);
    }
  });

  it("② 設置種別を太陽光系に変更すると「未回収」に戻る", () => {
    const step1 = changeField({}, new Set(), "paymentMethod", "ソーラーローン");
    const step2 = changeField(
      step1.values,
      step1.autoFilled,
      "installationType",
      "太陽光パネル+蓄電池",
    );
    for (const key of SOLAR_DOCS) {
      expect(step2.values[key]).toBe("未回収");
      expect(step2.autoFilled.has(key)).toBe(false);
    }
  });
});

describe("人が選んだ「不要」は保持する", () => {
  it("③ 人が選んだ「不要」は、表示に戻っても「不要」のまま", () => {
    // 設置種別=太陽光系（該当書類は表示中）で、人が「不要」を選ぶ
    const base = changeField(
      {},
      new Set(),
      "installationType",
      "太陽光パネル+蓄電池",
    );
    const chosen = changeField(
      base.values,
      base.autoFilled,
      "equipmentCertConsent",
      "不要",
    );
    expect(chosen.values.equipmentCertConsent).toBe("不要");
    expect(chosen.autoFilled.has("equipmentCertConsent")).toBe(false);

    // 一度非表示になり…
    const hidden = changeField(
      chosen.values,
      chosen.autoFilled,
      "installationType",
      "蓄電池のみ",
    );
    expect(hidden.values.equipmentCertConsent).toBe("不要");
    // 人の選択なので記録しない
    expect(hidden.autoFilled.has("equipmentCertConsent")).toBe(false);

    // …また表示に戻しても「不要」のまま
    const shown = changeField(
      hidden.values,
      hidden.autoFilled,
      "installationType",
      "太陽光パネルのみ",
    );
    expect(shown.values.equipmentCertConsent).toBe("不要");
  });

  it("人が「不要」を選び直したら、以降リセット対象にならない", () => {
    const step1 = changeField({}, new Set(), "paymentMethod", "ソーラーローン");
    expect(step1.autoFilled.has("equipmentCertConsent")).toBe(true);

    // システムが書いた「不要」を、人がそのまま選び直す
    const touched = changeField(
      step1.values,
      step1.autoFilled,
      "equipmentCertConsent",
      "不要",
    );
    expect(touched.autoFilled.has("equipmentCertConsent")).toBe(false);

    const shown = changeField(
      touched.values,
      touched.autoFilled,
      "installationType",
      "太陽光パネルのみ",
    );
    expect(shown.values.equipmentCertConsent).toBe("不要");
  });
});

describe("リセット先は項目ごとに異なる", () => {
  it("④ 付近見取り図は「未作成」、登記簿は「未確認」", () => {
    expect(documentPendingValue("vicinitySketchMap")).toBe("未作成");
    expect(documentPendingValue("registryBook")).toBe("未確認");
    expect(documentPendingValue("loanPaper")).toBe("未回収");
  });

  it("補助金事前申請書類は「未回収」へ戻る", () => {
    // 事前申請=有 → 表示。まず「不要」を焼き付ける
    const hidden = changeField({}, new Set(), "paymentMethod", "現金一括");
    expect(hidden.values.subsidyPreApplicationDocs).toBe("不要");
    expect(hidden.autoFilled.has("subsidyPreApplicationDocs")).toBe(true);

    const shown = changeField(
      hidden.values,
      hidden.autoFilled,
      "preApplication",
      "都道府県",
    );
    expect(shown.values.subsidyPreApplicationDocs).toBe("未回収");
  });
});

describe("書類と無関係な項目では書類に触れない", () => {
  it("⑤ 紹介ルート・室内現地調査・蓄電池複数台では「不要」が入らない", () => {
    for (const [key, value] of [
      ["introduction", "工務店"],
      ["indoorSurveyStatus", "未実施"],
      ["batteryMulti", "有"],
    ] as const) {
      const result = changeField({}, new Set(), key, value);
      for (const docKey of SOLAR_DOCS) {
        expect(result.values[docKey]).toBeUndefined();
      }
      expect(result.autoFilled.size).toBe(0);
    }
  });

  it("書類以外の非表示項目は従来どおり揃えられる", () => {
    // 紹介ルート=工務店以外 → 紹介手数料は 0、工務店名は "-" に揃う（既存挙動）。
    // 工務店名を揃えないと shouldPreserveHiddenFieldOnPut の保護に掛かり、
    // @pocket に古い工務店名が残り続けるため、トリガーからは外していない
    const withBuilder = changeField(
      { builderOrTorachiName: "テスト工務店" },
      new Set(),
      "introduction",
      "自社",
    );
    expect(withBuilder.values.referralFee).toBe("0");
    expect(withBuilder.values.builderOrTorachiName).toBe("-");
  });

  it("室内現地調査・蓄電池複数台でも書類以外は従来どおり", () => {
    const survey = changeField(
      { indoorSurveyScheduledDate: "2026-08-09" },
      new Set(),
      "indoorSurveyStatus",
      "実施済み",
    );
    expect(survey.values.indoorSurveyScheduledDate).toBe("");

    const battery = changeField(
      { batteryCapacity2: "9.8" },
      new Set(),
      "batteryMulti",
      "無",
    );
    expect(battery.values.batteryCapacity2).toBe("-");
  });
});

describe("forgetDocumentAutoFilled", () => {
  it("指定キーだけを外す", () => {
    const next = forgetDocumentAutoFilled(new Set(["a", "b"]), "a");
    expect(next.has("a")).toBe(false);
    expect(next.has("b")).toBe(true);
  });
});
