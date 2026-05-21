"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  applyCustomerInfoFormChange,
  isContractAmountDerived,
  syncContractAmountFromPayment,
} from "@/lib/customer-info-form/form-change";
import {
  formatCommaInteger,
  parseCommaIntegerDigits,
} from "@/lib/customer-info-form/numeric-comma";
import {
  formatPostalCodeInput,
  isValidPostalCodeFormat,
  lookupPostalCodeAddress,
} from "@/lib/customer-info-form/postal-code";
import {
  computePtTransfer,
  formatPtWithCommas,
  isSameApClStaff,
  parsePtDigitsOnly,
} from "@/lib/customer-info-form/pt-transfer";
import { inferPanelComboFromValues } from "@/lib/customer-info-form/panel-combo";
import { isCustomerInfoFormFieldVisible } from "@/lib/customer-info-form/rules";
import type {
  CustomerInfoFieldType,
  CustomerInfoFormValues,
} from "@/lib/customer-info-form/types";

const INPUT_CLASS =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 shadow-inner outline-none ring-1 ring-slate-100 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-200";

const SELECT_CLASS = INPUT_CLASS;

const CATALOG_MODEL_GROUPS = {
  panel: {
    keys: ["panelModel1", "panelModel2"] as const,
    apiPath: "/api/customer-info/panel-models",
    productLabel: "太陽光パネル",
    valueFieldLabel: "型番",
  },
  powerCon: {
    keys: ["powerConModel1", "powerConModel2"] as const,
    apiPath: "/api/customer-info/power-con-models",
    productLabel: "パワーコンディショナー",
    valueFieldLabel: "型番",
  },
  battery: {
    keys: ["batteryCapacity1", "batteryCapacity2"] as const,
    apiPath: "/api/customer-info/battery-capacity-options",
    productLabel: "蓄電池",
    valueFieldLabel: "出力または容量",
  },
} as const;

type CatalogModelKind = keyof typeof CATALOG_MODEL_GROUPS;

const CATALOG_MODEL_KEY_SET = new Set<string>([
  ...CATALOG_MODEL_GROUPS.panel.keys,
  ...CATALOG_MODEL_GROUPS.powerCon.keys,
  ...CATALOG_MODEL_GROUPS.battery.keys,
]);

function catalogKindForFieldKey(key: string): CatalogModelKind | null {
  if (
    (CATALOG_MODEL_GROUPS.panel.keys as readonly string[]).includes(key)
  ) {
    return "panel";
  }
  if (
    (CATALOG_MODEL_GROUPS.powerCon.keys as readonly string[]).includes(key)
  ) {
    return "powerCon";
  }
  if (
    (CATALOG_MODEL_GROUPS.battery.keys as readonly string[]).includes(key)
  ) {
    return "battery";
  }
  return null;
}

export type CustomerInfoFormFieldApi = {
  key: string;
  fieldId: string;
  label: string;
  type: CustomerInfoFieldType;
  options?: string[];
  optionsPending?: boolean;
  liffOnly?: boolean;
  value: string;
};

function parseCheckboxValue(raw: string): Set<string> {
  return new Set(
    raw
      .split(/[,、]/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function joinCheckboxValue(selected: Set<string>): string {
  return [...selected].join(",");
}

const FIELD_INVALID_CLASS =
  "border-red-300 ring-2 ring-red-200 focus:border-red-400 focus:ring-red-200";

function FieldControl({
  field,
  value,
  disabled,
  invalid,
  onChange,
  onBlur,
}: {
  field: CustomerInfoFormFieldApi;
  value: string;
  disabled: boolean;
  invalid?: boolean;
  onChange: (next: string) => void;
  onBlur?: () => void;
}) {
  const controlClass = invalid
    ? `${INPUT_CLASS} ${FIELD_INVALID_CLASS}`
    : INPUT_CLASS;
  const selectClass = invalid
    ? `${SELECT_CLASS} ${FIELD_INVALID_CLASS}`
    : SELECT_CLASS;
  if (field.type === "checkbox-group" && field.options?.length) {
    const selected = parseCheckboxValue(value);
    return (
      <div
        className={`flex flex-wrap gap-2 rounded-xl p-1 ${
          invalid ? "ring-2 ring-red-200" : ""
        }`}
      >
        {field.options.map((opt) => {
          const checked = selected.has(opt);
          return (
            <label
              key={opt}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium ${
                checked
                  ? "border-emerald-400 bg-emerald-50 text-emerald-900"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              <input
                type="checkbox"
                className="size-4 rounded border-slate-300 text-emerald-600"
                checked={checked}
                disabled={disabled}
                onChange={() => {
                  const next = new Set(selected);
                  if (checked) next.delete(opt);
                  else next.add(opt);
                  onChange(joinCheckboxValue(next));
                }}
              />
              {opt}
            </label>
          );
        })}
      </div>
    );
  }

  if (
    field.type === "select" &&
    field.options &&
    field.options.length > 0 &&
    !field.optionsPending
  ) {
    return (
      <select
        className={selectClass}
        value={value}
        disabled={disabled}
        onBlur={onBlur}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">選択してください</option>
        {field.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "pt-integer" || field.type === "comma-integer") {
    return (
      <input
        type="text"
        inputMode="numeric"
        className={controlClass}
        value={value}
        disabled={disabled}
        placeholder="例：1,234"
        onBlur={onBlur}
        onChange={(e) => {
          const digits = parseCommaIntegerDigits(e.target.value);
          onChange(formatCommaInteger(digits));
        }}
      />
    );
  }

  if (field.type === "postal-code") {
    return (
      <input
        type="text"
        inputMode="numeric"
        autoComplete="postal-code"
        className={controlClass}
        value={value}
        disabled={disabled}
        placeholder="000-0000"
        maxLength={8}
        onBlur={onBlur}
        onChange={(e) => onChange(formatPostalCodeInput(e.target.value))}
      />
    );
  }

  if (field.type === "date") {
    return (
      <input
        type="date"
        className={`${controlClass} calendar-date-input`}
        value={value}
        disabled={disabled}
        onBlur={onBlur}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <input
      type="text"
      className={controlClass}
      value={value}
      disabled={disabled}
      placeholder={
        field.optionsPending ? "一覧連携前のため直接入力" : undefined
      }
      onBlur={onBlur}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function PtTransferHint({ values }: { values: CustomerInfoFormValues }) {
  const digits = parsePtDigitsOnly(values.pt ?? "");
  if (!digits) return null;
  const { clpt, appt } = computePtTransfer(values);
  const same = isSameApClStaff(values);
  return (
    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
      転記プレビュー:{" "}
      {same ? (
        <>
          CLPT に <span className="font-semibold text-slate-700">{clpt}</span>
          （AP・CL 同一担当）
        </>
      ) : (
        <>
          APPT <span className="font-semibold text-slate-700">{appt}</span>
          {" / "}
          CLPT <span className="font-semibold text-slate-700">{clpt}</span>
          （PT÷2・切り捨て）
        </>
      )}
      ・保存時はカンマなし
    </p>
  );
}

function ContractAmountHint({ values }: { values: CustomerInfoFormValues }) {
  if (!isContractAmountDerived(values.paymentMethod ?? "")) return null;
  return (
    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
      現金とローン金額の合計を契約金額に自動反映します（保存時はカンマなし）
    </p>
  );
}

export function CustomerInfoEditForm({
  formFields,
  values,
  saving,
  missingCaptions,
  requiredFieldErrors,
  idToken,
  onChange,
}: {
  formFields: CustomerInfoFormFieldApi[];
  values: CustomerInfoFormValues;
  saving: boolean;
  missingCaptions?: string[];
  requiredFieldErrors?: ReadonlySet<string>;
  idToken: string | null;
  onChange: (key: string, value: string) => void;
}) {
  const [catalogOptions, setCatalogOptions] = useState<
    Record<CatalogModelKind, string[]>
  >({ panel: [], powerCon: [], battery: [] });
  const [catalogLoading, setCatalogLoading] = useState<
    Record<CatalogModelKind, boolean>
  >({ panel: false, powerCon: false, battery: false });
  const [catalogConfigured, setCatalogConfigured] = useState<
    Record<CatalogModelKind, boolean>
  >({ panel: true, powerCon: true, battery: true });

  const displayValues = useMemo(
    () => syncContractAmountFromPayment(values),
    [values],
  );

  const manufacturer = (displayValues.manufacturer ?? "").trim();

  useEffect(() => {
    if (!idToken || !manufacturer) {
      setCatalogOptions({ panel: [], powerCon: [], battery: [] });
      setCatalogLoading({ panel: false, powerCon: false, battery: false });
      return;
    }

    let cancelled = false;
    setCatalogLoading({ panel: true, powerCon: true, battery: true });

    const fetchKind = async (kind: CatalogModelKind) => {
      const group = CATALOG_MODEL_GROUPS[kind];
      const params = new URLSearchParams({ manufacturer });
      const [k1, k2] = group.keys;
      const keep1 = displayValues[k1] ?? "";
      const keep2 = displayValues[k2] ?? "";
      if (keep1) params.set("keep1", keep1);
      if (keep2) params.set("keep2", keep2);

      try {
        const res = await fetch(`${group.apiPath}?${params.toString()}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = (await res.json()) as {
          options?: string[];
          configured?: boolean;
        };
        if (cancelled) return;
        if (!res.ok) {
          setCatalogOptions((prev) => ({ ...prev, [kind]: [] }));
          setCatalogConfigured((prev) => ({ ...prev, [kind]: false }));
          return;
        }
        setCatalogOptions((prev) => ({
          ...prev,
          [kind]: data.options ?? [],
        }));
        setCatalogConfigured((prev) => ({
          ...prev,
          [kind]: data.configured !== false,
        }));
      } catch {
        if (!cancelled) {
          setCatalogOptions((prev) => ({ ...prev, [kind]: [] }));
          setCatalogConfigured((prev) => ({ ...prev, [kind]: false }));
        }
      } finally {
        if (!cancelled) {
          setCatalogLoading((prev) => ({ ...prev, [kind]: false }));
        }
      }
    };

    void Promise.all([
      fetchKind("panel"),
      fetchKind("powerCon"),
      fetchKind("battery"),
    ]);

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keep は初回表示用
  }, [idToken, manufacturer]);

  const visibleFields = useMemo(() => {
    return formFields
      .filter((f) => isCustomerInfoFormFieldVisible(f.key, displayValues))
      .map((f) => {
        const kind = catalogKindForFieldKey(f.key);
        if (!kind) return f;
        if (!manufacturer) {
          return { ...f, options: [], optionsPending: true };
        }
        if (catalogLoading[kind]) {
          return { ...f, options: [], optionsPending: true };
        }
        if (!catalogConfigured[kind]) {
          return f;
        }
        return {
          ...f,
          options: catalogOptions[kind],
          optionsPending: false,
        };
      });
  }, [
    formFields,
    displayValues,
    manufacturer,
    catalogOptions,
    catalogLoading,
    catalogConfigured,
  ]);

  const propagateValues = useCallback(
    (next: CustomerInfoFormValues) => {
      for (const [k, v] of Object.entries(next)) {
        if (values[k] !== v) onChange(k, v);
      }
    },
    [onChange, values],
  );

  const handleFieldChange = useCallback(
    (key: string, value: string) => {
      let next = applyCustomerInfoFormChange(values, key, value);
      if (key === "manufacturer") {
        next = {
          ...next,
          panelModel1: "",
          panelModel2: "",
          powerConModel1: "",
          powerConModel2: "",
          batteryCapacity1: "",
          batteryCapacity2: "",
        };
        next = { ...next, panelCombo: inferPanelComboFromValues(next) };
      }
      if (key === "powerConCount" && value !== "2") {
        next = { ...next, powerConModel2: "" };
      }
      if (key === "batteryMulti" && value !== "有") {
        next = { ...next, batteryCapacity2: "" };
      }
      if (key === "panelModel2") {
        next = { ...next, panelCombo: inferPanelComboFromValues(next) };
      }
      propagateValues(next);
    },
    [propagateValues, values],
  );

  const handlePostalBlur = useCallback(async () => {
    const code = (values.postalCode ?? "").trim();
    if (!isValidPostalCodeFormat(code)) return;
    const hit = await lookupPostalCodeAddress(code);
    if (!hit) return;
    propagateValues({
      ...values,
      prefecture: hit.prefecture,
      city: hit.city,
      address: hit.address,
    });
  }, [propagateValues, values]);

  return (
    <div className="flex flex-col gap-3">
      {missingCaptions && missingCaptions.length > 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
          @pocket に見つからない列: {missingCaptions.join("、")}
          （見出し名が一致するか CUSTOMER_INFO_FIELD_* を確認してください）
        </p>
      ) : null}
      {visibleFields.map((field) => {
        const invalid = requiredFieldErrors?.has(field.key) ?? false;
        return (
        <label key={field.key} className="block">
          <span className="mb-1 block text-[12px] font-semibold text-slate-700">
            {field.label}
            <span className="ml-1 text-[11px] font-bold text-red-600">必須</span>
            {field.optionsPending ? (
              <span className="ml-1 font-normal text-slate-400">
                （一覧は後日連携）
              </span>
            ) : null}
          </span>
          <FieldControl
            field={field}
            invalid={invalid}
            value={
              field.key === "contractAmount" &&
              isContractAmountDerived(displayValues.paymentMethod ?? "")
                ? (displayValues.contractAmount ?? "")
                : field.key === "panelCombo"
                  ? displayValues.panelCombo === "有"
                    ? "有"
                    : "無"
                  : (displayValues[field.key] ?? "")
            }
            disabled={
              saving ||
              (field.key === "contractAmount" &&
                isContractAmountDerived(displayValues.paymentMethod ?? ""))
            }
            onChange={(next) => handleFieldChange(field.key, next)}
            onBlur={
              field.key === "postalCode" ? () => void handlePostalBlur() : undefined
            }
          />
          {invalid ? (
            <p className="mt-1 text-[11px] font-semibold text-red-600">
              入力してください
            </p>
          ) : null}
          {field.key === "pt" ? <PtTransferHint values={displayValues} /> : null}
          {field.key === "contractAmount" ? (
            <ContractAmountHint values={displayValues} />
          ) : null}
          {field.key === "postalCode" ? (
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              000-0000 形式で入力すると都道府県・市区郡・町村+番地を自動入力します
            </p>
          ) : null}
          {(() => {
            const catalogKind = catalogKindForFieldKey(field.key);
            if (!catalogKind) return null;
            return (
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                {!manufacturer
                  ? "先にメーカーを選択すると、商品一覧から型番を選べます"
                  : catalogLoading[catalogKind]
                    ? "型番一覧を読み込み中…"
                    : `商品一覧（${CATALOG_MODEL_GROUPS[catalogKind].productLabel}・現行・${CATALOG_MODEL_GROUPS[catalogKind].valueFieldLabel}）から抽出`}
              </p>
            );
          })()}
        </label>
        );
      })}
    </div>
  );
}
