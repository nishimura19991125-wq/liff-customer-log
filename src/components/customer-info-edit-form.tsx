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
import { isCustomerInfoFormFieldVisible } from "@/lib/customer-info-form/rules";
import type {
  CustomerInfoFieldType,
  CustomerInfoFormValues,
} from "@/lib/customer-info-form/types";

const INPUT_CLASS =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 shadow-inner outline-none ring-1 ring-slate-100 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-200";

const SELECT_CLASS = INPUT_CLASS;

const PANEL_MODEL_KEYS = ["panelModel1", "panelModel2"] as const;

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

function FieldControl({
  field,
  value,
  disabled,
  onChange,
  onBlur,
}: {
  field: CustomerInfoFormFieldApi;
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
  onBlur?: () => void;
}) {
  if (field.type === "checkbox-group" && field.options?.length) {
    const selected = parseCheckboxValue(value);
    return (
      <div className="flex flex-wrap gap-2">
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
        className={SELECT_CLASS}
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
        className={INPUT_CLASS}
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
        className={INPUT_CLASS}
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
        className={`${INPUT_CLASS} calendar-date-input`}
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
      className={INPUT_CLASS}
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
  idToken,
  onChange,
}: {
  formFields: CustomerInfoFormFieldApi[];
  values: CustomerInfoFormValues;
  saving: boolean;
  missingCaptions?: string[];
  idToken: string | null;
  onChange: (key: string, value: string) => void;
}) {
  const [panelModelOptions, setPanelModelOptions] = useState<string[]>([]);
  const [panelModelsLoading, setPanelModelsLoading] = useState(false);
  const [panelModelsConfigured, setPanelModelsConfigured] = useState(true);

  const displayValues = useMemo(
    () => syncContractAmountFromPayment(values),
    [values],
  );

  const manufacturer = (displayValues.manufacturer ?? "").trim();

  useEffect(() => {
    if (!idToken || !manufacturer) {
      setPanelModelOptions([]);
      setPanelModelsLoading(false);
      return;
    }

    let cancelled = false;
    const params = new URLSearchParams({ manufacturer });
    const keep1 = displayValues.panelModel1 ?? "";
    const keep2 = displayValues.panelModel2 ?? "";
    if (keep1) params.set("keep1", keep1);
    if (keep2) params.set("keep2", keep2);

    setPanelModelsLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/customer-info/panel-models?${params.toString()}`,
          { headers: { Authorization: `Bearer ${idToken}` } },
        );
        const data = (await res.json()) as {
          options?: string[];
          configured?: boolean;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setPanelModelOptions([]);
          setPanelModelsConfigured(false);
          return;
        }
        setPanelModelOptions(data.options ?? []);
        setPanelModelsConfigured(data.configured !== false);
      } catch {
        if (!cancelled) {
          setPanelModelOptions([]);
          setPanelModelsConfigured(false);
        }
      } finally {
        if (!cancelled) setPanelModelsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // manufacturer 変更時のみ再取得（品番変更では再取得しない）
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keep1/keep2 は初回表示用
  }, [idToken, manufacturer]);

  const visibleFields = useMemo(() => {
    return formFields
      .filter((f) => isCustomerInfoFormFieldVisible(f.key, displayValues))
      .map((f) => {
        if (!PANEL_MODEL_KEYS.includes(f.key as (typeof PANEL_MODEL_KEYS)[number])) {
          return f;
        }
        if (!manufacturer) {
          return { ...f, options: [], optionsPending: true };
        }
        if (panelModelsLoading) {
          return { ...f, options: [], optionsPending: true };
        }
        if (!panelModelsConfigured) {
          return f;
        }
        return {
          ...f,
          options: panelModelOptions,
          optionsPending: false,
        };
      });
  }, [
    formFields,
    displayValues,
    manufacturer,
    panelModelOptions,
    panelModelsLoading,
    panelModelsConfigured,
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
        next = { ...next, panelModel1: "", panelModel2: "" };
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
      {visibleFields.map((field) => (
        <label key={field.key} className="block">
          <span className="mb-1 block text-[12px] font-semibold text-slate-700">
            {field.label}
            {field.optionsPending ? (
              <span className="ml-1 font-normal text-slate-400">
                （一覧は後日連携）
              </span>
            ) : null}
          </span>
          <FieldControl
            field={field}
            value={
              field.key === "contractAmount" &&
              isContractAmountDerived(displayValues.paymentMethod ?? "")
                ? (displayValues.contractAmount ?? "")
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
          {field.key === "pt" ? <PtTransferHint values={displayValues} /> : null}
          {field.key === "contractAmount" ? (
            <ContractAmountHint values={displayValues} />
          ) : null}
          {field.key === "postalCode" ? (
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              000-0000 形式で入力すると都道府県・市区郡・町村+番地を自動入力します
            </p>
          ) : null}
          {PANEL_MODEL_KEYS.includes(
            field.key as (typeof PANEL_MODEL_KEYS)[number],
          ) ? (
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              {!manufacturer
                ? "先にメーカーを選択すると、商品一覧から型番を選べます"
                : panelModelsLoading
                  ? "型番一覧を読み込み中…"
                  : "商品一覧（太陽光パネル・現行）から抽出"}
            </p>
          ) : null}
        </label>
      ))}
    </div>
  );
}
