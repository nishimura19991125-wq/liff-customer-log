import { checkboxGroupValueToPocketArray } from "@/lib/customer-info-form/checkbox-pocket";
import { contractAmountForPocket } from "@/lib/customer-info-form/form-change";
import { commaIntegerForPocket } from "@/lib/customer-info-form/numeric-comma";
import {
  INSTALLATION_TYPES_BATTERY_OR_POWERCON_ONLY,
  INSTALLATION_TYPES_WITH_SOLAR_PANEL,
  installationTypeHidesPanelSection,
  PAYMENT_METHODS_WITH_CASH,
  PAYMENT_METHODS_WITH_LOAN,
  introductionRequiresBuilderName,
  introductionRequiresReferralFee,
  preApplicationRequiresDocuments,
  subsidyIncludesCity,
  subsidyIncludesOther,
  subsidyIncludesPrefecture,
} from "@/lib/customer-info-form/options";
import {
  CUSTOMER_INFO_FORM_FIELDS,
  INSTALLATION_TYPE_OPTIONS,
  ROOF_MATERIAL_OPTIONS,
} from "@/lib/customer-info-form/schema";
import { dateValueForPocket } from "@/lib/customer-info-form/date-pocket";
import { decimalKwForPocket } from "@/lib/customer-info-form/decimal-kw";
import { postalCodeForPocket } from "@/lib/customer-info-form/postal-code";
import type {
  CustomerInfoFormFieldResolved,
  CustomerInfoFormValues,
} from "@/lib/customer-info-form/types";

const HIDDEN_DASH = "-";

/** 未入力時に @pocket へ 0 を送るフィールド */
const POCKET_ZERO_WHEN_EMPTY_KEYS = new Set([
  "panelCount1",
  "panelCount2",
  "extraPartsAmount",
  "referralFee",
  "panelCapacityKw",
]);

/** 非表示時に @pocket へ 0 を送るフィールド（"-" は半角数字エラーになる） */
const POCKET_ZERO_WHEN_HIDDEN_KEYS = new Set([
  "panelCount1",
  "panelCount2",
  "cashAmount",
  "loanAmount",
  "referralFee",
  "panelCapacityKw",
]);

/** 未入力・非表示時に @pocket へ "-" を送るフィールド */
const POCKET_DASH_WHEN_EMPTY_KEYS = new Set([
  "panelModel1",
  "panelModel2",
  "powerConModel1",
  "powerConModel2",
  "batteryCapacity1",
  "batteryCapacity2",
  "batteryModel1",
  "batteryModel2",
]);

const DECIMAL_KW_KEYS = new Set(["panelCapacityKw"]);

const COMMA_INTEGER_KEYS = new Set([
  "panelCount1",
  "panelCount2",
  "contractAmount",
  "cashAmount",
  "loanAmount",
  "referralFee",
]);

function isEmptyPocketInput(raw: string): boolean {
  const t = raw.trim();
  return t === "" || t === "-";
}

function pocketFieldValueForPut(
  key: string,
  raw: string,
  visible: boolean,
  hiddenFallback: string,
  values?: CustomerInfoFormValues,
): string {
  if (key === "contractAmount" && values) {
    if (!visible) return hiddenFallback;
    return contractAmountForPocket(values) || hiddenFallback;
  }
  if (key === "postalCode") {
    if (!visible) return hiddenFallback;
    const pocket = postalCodeForPocket(raw);
    return pocket ?? hiddenFallback;
  }
  if (DECIMAL_KW_KEYS.has(key)) {
    if (!visible) {
      if (
        POCKET_ZERO_WHEN_HIDDEN_KEYS.has(key) ||
        POCKET_ZERO_WHEN_EMPTY_KEYS.has(key)
      ) {
        return "0";
      }
      return hiddenFallback;
    }
    const pocket = decimalKwForPocket(raw);
    if (pocket !== null) return pocket;
    if (POCKET_ZERO_WHEN_EMPTY_KEYS.has(key)) return "0";
    return hiddenFallback;
  }
  if (COMMA_INTEGER_KEYS.has(key)) {
    if (!visible) {
      if (
        POCKET_ZERO_WHEN_HIDDEN_KEYS.has(key) ||
        POCKET_ZERO_WHEN_EMPTY_KEYS.has(key)
      ) {
        return "0";
      }
      return hiddenFallback;
    }
    const pocket = commaIntegerForPocket(raw);
    if (pocket !== null) return pocket;
    if (POCKET_ZERO_WHEN_EMPTY_KEYS.has(key)) return "0";
    return hiddenFallback;
  }
  if (POCKET_ZERO_WHEN_EMPTY_KEYS.has(key)) {
    if (!visible || isEmptyPocketInput(raw)) return "0";
    return raw.trim();
  }
  if (POCKET_DASH_WHEN_EMPTY_KEYS.has(key)) {
    if (!visible) return hiddenFallback;
    if (isEmptyPocketInput(raw)) return hiddenFallback;
    return raw.trim();
  }
  if (!visible) return hiddenFallback;
  return raw.trim();
}

const ROOF_MATERIAL_MODEL_VISIBLE = new Set([
  "平板瓦",
  "洋瓦",
  "和瓦",
  "その他",
]);

const INSTALLATION_TYPES_HIDE_ROOF = new Set<string>([
  "蓄電池のみ",
  "パワコン取替のみ",
]);

function norm(v: string | undefined): string {
  return (v ?? "").trim();
}

/** フォーム上で入力欄を表示するか */
export function isCustomerInfoFormFieldVisible(
  key: string,
  values: CustomerInfoFormValues,
): boolean {
  const panelCombo = norm(values.panelCombo);
  const powerConCount = norm(values.powerConCount);
  const batteryMulti = norm(values.batteryMulti);
  const ecoCuteNew = norm(values.ecoCuteNew);
  const ihNew = norm(values.ihNew);
  const v2hNew = norm(values.v2hNew);
  const installationType = norm(values.installationType);
  const roofMaterial = norm(values.roofMaterial);
  const extraParts = norm(values.extraParts);
  const paymentMethod = norm(values.paymentMethod);
  const subsidy = norm(values.subsidy);
  const indoorSurveyStatus = norm(values.indoorSurveyStatus);
  const preApplication = norm(values.preApplication);
  const introduction = norm(values.introduction);

  switch (key) {
    case "referralFee":
      return introductionRequiresReferralFee(introduction);
    case "builderOrTorachiName":
      return introductionRequiresBuilderName(introduction);
    case "panelCombo":
    case "panelModel1":
    case "panelCount1":
    case "panelCapacityKw":
      return !installationTypeHidesPanelSection(installationType);
    case "panelModel2":
    case "panelCount2":
      return (
        !installationTypeHidesPanelSection(installationType) &&
        panelCombo === "有"
      );
    case "powerConModel2":
      // 台数が 2 のときのみ品番②を表示（1 台のときは非表示で @pocket には "-"）
      return powerConCount === "2";
    case "batteryCapacity2":
      return batteryMulti === "有";
    case "ecoCuteModel":
      return ecoCuteNew === "有";
    case "ihModel":
      return ihNew === "有";
    case "v2hModel":
      return v2hNew === "有";
    case "roofMaterial":
      return !INSTALLATION_TYPES_HIDE_ROOF.has(installationType);
    case "roofMaterialModel":
      if (INSTALLATION_TYPES_HIDE_ROOF.has(installationType)) return false;
      return ROOF_MATERIAL_MODEL_VISIBLE.has(roofMaterial);
    case "extraPartsUrl":
    case "extraPartsName":
    case "extraPartsAmount":
      return extraParts === "有";
    case "creditCompany":
    case "loanPaper":
    case "groupCreditLifeInsurance":
      return PAYMENT_METHODS_WITH_LOAN.has(paymentMethod);
    case "cashAmount":
      return PAYMENT_METHODS_WITH_CASH.has(paymentMethod);
    case "loanAmount":
      return PAYMENT_METHODS_WITH_LOAN.has(paymentMethod);
    case "prefectureSubsidy":
      return subsidyIncludesPrefecture(subsidy);
    case "citySubsidy":
      return subsidyIncludesCity(subsidy);
    case "otherSubsidy":
      return subsidyIncludesOther(subsidy);
    case "indoorSurveyScheduledDate":
      return indoorSurveyStatus === "未実施";
    case "feedInBankAccountForm":
    case "powerOfAttorneyStorage":
    case "equipmentCertConsent":
    case "operatingCostReportConsent":
    case "freeUseGenerationConsent":
      return INSTALLATION_TYPES_WITH_SOLAR_PANEL.has(installationType);
    case "powerOfAttorneyChangeCert":
    case "powerOfAttorneyIdPassword":
      return INSTALLATION_TYPES_BATTERY_OR_POWERCON_ONLY.has(
        installationType,
      );
    case "subsidyPreApplicationDocs":
      return preApplicationRequiresDocuments(preApplication);
    case "apBranch":
    case "clBranch":
    case "batteryModel1":
    case "batteryModel2":
      return false;
    default:
      return true;
  }
}

function hiddenPayloadValue(
  def: { hiddenValue?: string },
): string {
  return def.hiddenValue ?? HIDDEN_DASH;
}

function checkboxSelections(raw: string): string[] {
  return raw
    .split(/[,、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 非表示項目を PUT するとき、フォームに実データが残っている場合は @pocket を上書きしない。
 * （設置種別未読込などで一時的に非表示になった書類回収状況等を "-" で消さない）
 */
function shouldPreserveHiddenFieldOnPut(
  fieldKey: string,
  raw: string,
  hiddenFallback: string,
  hiddenPut: string,
): boolean {
  if (
    POCKET_DASH_WHEN_EMPTY_KEYS.has(fieldKey) ||
    POCKET_ZERO_WHEN_EMPTY_KEYS.has(fieldKey) ||
    POCKET_ZERO_WHEN_HIDDEN_KEYS.has(fieldKey)
  ) {
    return false;
  }
  if (isEmptyPocketInput(raw)) return false;
  if (raw === hiddenFallback || raw === hiddenPut) return false;
  return true;
}

/**
 * 表示状態に応じて @pocket PUT 用 payload（schema uniqueId → 値）を組み立てる。
 * 非表示項目は "-"（または hiddenValue）を送る。ただし意図的にクリアした場合のみ。
 */
export function buildCustomerInfoFormPayload(
  values: CustomerInfoFormValues,
  resolved: CustomerInfoFormFieldResolved[],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of resolved) {
    if (field.liffOnly || field.hiddenInForm) continue;
    const visible = isCustomerInfoFormFieldVisible(field.key, values);
    const raw = norm(values[field.key]);
    if (field.type === "checkbox-group") {
      if (visible) {
        payload[field.fieldId] = checkboxGroupValueToPocketArray(
          raw,
          field.options,
        );
      } else if (checkboxSelections(raw).length === 0) {
        payload[field.fieldId] = [];
      }
      continue;
    }
    if (field.type === "date") {
      if (!visible) continue;
      const pocketDate = dateValueForPocket(raw);
      if (pocketDate) payload[field.fieldId] = pocketDate;
      continue;
    }
    const hiddenFallback = hiddenPayloadValue(field);
    if (!visible) {
      const hiddenPut = pocketFieldValueForPut(
        field.key,
        raw,
        false,
        hiddenFallback,
        values,
      );
      if (
        shouldPreserveHiddenFieldOnPut(
          field.key,
          raw,
          hiddenFallback,
          hiddenPut,
        )
      ) {
        continue;
      }
      payload[field.fieldId] = hiddenPut;
      continue;
    }
    payload[field.fieldId] = pocketFieldValueForPut(
      field.key,
      raw,
      true,
      hiddenFallback,
      values,
    );
  }
  return payload;
}

/** 設置種別の選択肢（型安全の再エクスポート用） */
export function customerInfoInstallationTypeOptions(): readonly string[] {
  return INSTALLATION_TYPE_OPTIONS;
}

export function customerInfoRoofMaterialOptions(): readonly string[] {
  return ROOF_MATERIAL_OPTIONS;
}

/** 保存前に非表示項目を values 上でダッシュに揃える（UI プレビュー用） */
export function applyCustomerInfoHiddenDefaultsToValues(
  values: CustomerInfoFormValues,
): CustomerInfoFormValues {
  const next = { ...values };
  for (const def of CUSTOMER_INFO_FORM_FIELDS) {
    if (!isCustomerInfoFormFieldVisible(def.key, next)) {
      if (POCKET_ZERO_WHEN_HIDDEN_KEYS.has(def.key)) {
        next[def.key] = "0";
      } else if (def.type === "date") {
        next[def.key] = "";
      } else {
        next[def.key] = hiddenPayloadValue(def);
      }
    }
  }
  return next;
}
