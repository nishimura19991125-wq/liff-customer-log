import {
  CUSTOMER_INFO_FORM_FIELDS,
  INSTALLATION_TYPE_OPTIONS,
  ROOF_MATERIAL_OPTIONS,
} from "@/lib/customer-info-form/schema";
import type {
  CustomerInfoFormFieldResolved,
  CustomerInfoFormValues,
} from "@/lib/customer-info-form/types";

const HIDDEN_DASH = "-";

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

  switch (key) {
    case "panelModel2":
    case "panelCount2":
      return panelCombo === "有";
    case "powerConModel2":
      // 台数が 2 のときは品番②は非表示（@pocket には "-"）
      return powerConCount !== "2";
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
    default:
      return true;
  }
}

function hiddenPayloadValue(
  def: { hiddenValue?: string },
): string {
  return def.hiddenValue ?? HIDDEN_DASH;
}

/**
 * 表示状態に応じて @pocket PUT 用 payload（schema uniqueId → 値）を組み立てる。
 * 非表示項目は "-"（または hiddenValue）を送る。
 */
export function buildCustomerInfoFormPayload(
  values: CustomerInfoFormValues,
  resolved: CustomerInfoFormFieldResolved[],
): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const field of resolved) {
    const visible = isCustomerInfoFormFieldVisible(field.key, values);
    if (visible) {
      payload[field.fieldId] = norm(values[field.key]);
    } else {
      payload[field.fieldId] = hiddenPayloadValue(field);
    }
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
      next[def.key] = hiddenPayloadValue(def);
    }
  }
  return next;
}
