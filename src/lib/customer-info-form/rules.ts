import { CUSTOMER_DOCUMENT_KEYS } from "@/lib/customer-documents-spec";
import { checkboxGroupValueToPocketArray } from "@/lib/customer-info-form/checkbox-pocket";
import { contractAmountForPocket } from "@/lib/customer-info-form/form-change";
import { commaIntegerForPocket } from "@/lib/customer-info-form/numeric-comma";
import {
  INSTALLATION_TYPES_BATTERY_OR_POWERCON_ONLY,
  INSTALLATION_TYPES_WITH_SOLAR_PANEL,
  installationTypeHidesBatterySection,
  installationTypeHidesPanelSection,
  isIndoorSurveyStatusNotDone,
  PAYMENT_METHODS_WITH_CASH,
  PAYMENT_METHODS_WITH_LOAN,
  introductionRequiresBuilderName,
  introductionRequiresReferralFee,
  preApplicationRequiresDocuments,
  shouldShowWiringMethod,
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
import { phoneNumberForPocket } from "@/lib/customer-info-form/phone-number";
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

/**
 * 非表示のあいだは値を一切書かず、@pocket の既存値をそのまま残すフィールド。
 *
 * 既定の動きでは、非表示かつ値が空（または "-"）のときに "-" を書き込む。
 * 選択式の列にとって "-" は選択肢に無い値なので、画面のリストが未選択に
 * 見えるのに値だけ入る状態（タスクG と同じ形）になる。
 * 配線方式は表示条件（shouldShowWiringMethod）が外れているあいだ、
 * 保存しても @pocket 側を触らない。
 */
const POCKET_PRESERVE_WHEN_HIDDEN_KEYS = new Set(["wiringMethod"]);

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

/**
 * 契約金額は現金+ローンから引き直して書き込む。
 *
 * 連動する支払方法のとき入力欄は disabled で、画面には常に計算結果が出る。
 * 保存も同じ計算を通すことで、**画面の表示と保存される値を一致させる**。
 * 契約金額は @pocket 側でも「現金 + ローン金額」と一致する運用のため、
 * 両者がずれることは起こりえない（運用で確認済み）。
 */
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
  if (key === "phone") {
    if (!visible) return hiddenFallback;
    const pocket = phoneNumberForPocket(raw);
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
  const indoorSurveyStatus = values.indoorSurveyStatus;
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
    case "batteryMulti":
    case "batteryCapacity1":
      return !installationTypeHidesBatterySection(installationType);
    case "batteryCapacity2":
      return (
        !installationTypeHidesBatterySection(installationType) &&
        batteryMulti === "有"
      );
    case "ecoCuteModel":
      return ecoCuteNew === "有";
    case "ihModel":
      return ihNew === "有";
    case "v2hModel":
      return v2hNew === "有";
    case "wiringMethod":
      // 表示・必須・保存の3つがこの1関数から導かれる（別々に書かないこと）
      return shouldShowWiringMethod(installationType);
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
      return isIndoorSurveyStatusNotDone(indoorSurveyStatus);
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
 * 非表示項目を PUT するとき、@pocket 側の値をそのまま残すか（タスクM-1）。
 *
 * 設置種別や支払方法を切り替えると、数量・金額・型番の各列が一時的に
 * 非表示になる。以前はこれらのキーに対して無条件で false を返しており、
 * **非表示になった時点で 0 や "-" が書き込まれて値が失われていた。**
 * 表示条件を戻しても復元されない。
 *
 * 一度消えると同じ内容を再入力することになり業務上の負担が大きいので、
 * **非表示になった項目は payload から落とし、@pocket の値を残す**方針にした。
 * 書類ステータス（タスクG）の「システムが書いた値を戻す」方式とは別で、
 * こちらはそもそも書き込まない。
 *
 * 保護するのは非表示になった項目だけ。表示中に利用者が空にした場合は、
 * この関数を通らず従来どおり空・0・"-" が書き込まれる。
 */
function shouldPreserveHiddenFieldOnPut(
  fieldKey: string,
  raw: string,
  hiddenFallback: string,
  hiddenPut: string,
): boolean {
  if (POCKET_PRESERVE_WHEN_HIDDEN_KEYS.has(fieldKey)) return true;
  // 数量・金額・型番。panelCapacityKw の個別扱いはこの分岐に吸収した
  if (
    POCKET_DASH_WHEN_EMPTY_KEYS.has(fieldKey) ||
    POCKET_ZERO_WHEN_EMPTY_KEYS.has(fieldKey) ||
    POCKET_ZERO_WHEN_HIDDEN_KEYS.has(fieldKey)
  ) {
    return true;
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
      if (pocketDate) {
        payload[field.fieldId] = pocketDate;
      } else if (isEmptyPocketInput(raw)) {
        payload[field.fieldId] = "";
      }
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

/**
 * 保存前に非表示項目を values 上でダッシュに揃える（UI プレビュー用）。
 *
 * includeDocumentFields=false のとき、書類16項目には触れない（タスクG-2）。
 * 書類の表示条件は 支払方法・設置種別・事前申請有無 の3つだけで決まるため、
 * それ以外（紹介ルート・室内現地調査実施状況・蓄電池複数台設置）の変更で
 * 書類に hiddenValue を書くのは、条件が変わっていないのに値を壊す動作になる。
 *
 * 3キー以外でも呼び出しは続ける。それらは 紹介手数料・工務店名・
 * 室内調査予定日・蓄電池容量② の hiddenValue 適用に必要で、
 * とくに工務店名は shouldPreserveHiddenFieldOnPut の保護に掛かるため、
 * ここで揃えないと @pocket に古い値が残り続ける。
 */
export function applyCustomerInfoHiddenDefaultsToValues(
  values: CustomerInfoFormValues,
  options: { includeDocumentFields?: boolean } = {},
): CustomerInfoFormValues {
  const includeDocumentFields = options.includeDocumentFields !== false;
  const next = { ...values };
  for (const def of CUSTOMER_INFO_FORM_FIELDS) {
    if (!includeDocumentFields && CUSTOMER_DOCUMENT_KEYS.has(def.key)) {
      continue;
    }
    // 非表示のあいだ値を残す項目は "-" で潰さない（保存でも送らない）
    if (POCKET_PRESERVE_WHEN_HIDDEN_KEYS.has(def.key)) continue;
    if (!isCustomerInfoFormFieldVisible(def.key, next)) {
      if (
        POCKET_ZERO_WHEN_HIDDEN_KEYS.has(def.key) &&
        def.key !== "panelCapacityKw"
      ) {
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
