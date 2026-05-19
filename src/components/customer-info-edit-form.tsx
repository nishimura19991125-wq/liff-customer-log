"use client";

import { useMemo } from "react";

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
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px] text-slate-900 shadow-inner outline-none ring-1 ring-slate-100 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-200";

const SELECT_CLASS = INPUT_CLASS;

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
}: {
  field: CustomerInfoFormFieldApi;
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
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

  if (field.type === "pt-integer") {
    return (
      <input
        type="text"
        inputMode="numeric"
        className={INPUT_CLASS}
        value={value}
        disabled={disabled}
        placeholder="例：1,234"
        onChange={(e) => {
          const digits = parsePtDigitsOnly(e.target.value);
          onChange(formatPtWithCommas(digits));
        }}
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

export function CustomerInfoEditForm({
  formFields,
  values,
  saving,
  missingCaptions,
  onChange,
}: {
  formFields: CustomerInfoFormFieldApi[];
  values: CustomerInfoFormValues;
  saving: boolean;
  missingCaptions?: string[];
  onChange: (key: string, value: string) => void;
}) {
  const visibleFields = useMemo(() => {
    return formFields.filter((f) =>
      isCustomerInfoFormFieldVisible(f.key, values),
    );
  }, [formFields, values]);

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
            value={values[field.key] ?? ""}
            disabled={saving}
            onChange={(next) => onChange(field.key, next)}
          />
          {field.key === "pt" ? <PtTransferHint values={values} /> : null}
        </label>
      ))}
    </div>
  );
}
