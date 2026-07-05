"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { mergeStaffNameOptions } from "@/lib/staff-name-options";

type ApClStaffRolePicker = {
  options: string[];
  defaultName?: string | null;
};

type ApClStaffPickerPayload = {
  configured: boolean;
  configError?: string;
  rosterEmpty?: boolean;
  ap: ApClStaffRolePicker;
  cl: ApClStaffRolePicker;
};

import {
  applyCustomerInfoFormChange,
  isContractAmountDerived,
  syncContractAmountFromPayment,
} from "@/lib/customer-info-form/form-change";
import { formatDecimalKwInput } from "@/lib/customer-info-form/decimal-kw";
import {
  formatCommaInteger,
  parseCommaIntegerDigits,
} from "@/lib/customer-info-form/numeric-comma";
import {
  formatPhoneNumberInput,
} from "@/lib/customer-info-form/phone-number";
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
import { KatakanaAwareTextInput } from "@/components/katakana-aware-text-input";
import {
  applyCustomerInfoHiddenDefaultsToValues,
  isCustomerInfoFormFieldVisible,
} from "@/lib/customer-info-form/rules";
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
  required?: boolean;
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

const AP_CL_STAFF_KEYS = new Set(["apStaff", "clStaff"]);

const NAME_SPLIT_GROUPS = {
  customerFamilyName: {
    groupLabel: "お客様名",
    givenKey: "customerGivenName",
    familyLabel: "苗字",
    givenLabel: "名前",
    familyPlaceholder: "例：山田",
    givenPlaceholder: "例：太郎",
    familyAutoComplete: "family-name",
    givenAutoComplete: "given-name",
  },
  furiganaFamily: {
    groupLabel: "フリガナ",
    givenKey: "furiganaGiven",
    familyLabel: "セイ",
    givenLabel: "メイ",
    familyPlaceholder: "例：ヤマダ",
    givenPlaceholder: "例：タロウ",
    familyAutoComplete: undefined,
    givenAutoComplete: undefined,
  },
} as const;

const NAME_SPLIT_GIVEN_KEYS = new Set(["customerGivenName", "furiganaGiven"]);

function NameSplitFieldGroup({
  groupLabel,
  familyLabel,
  givenLabel,
  familyValue,
  givenValue,
  familyPlaceholder,
  givenPlaceholder,
  familyAutoComplete,
  givenAutoComplete,
  disabled,
  familyInvalid,
  givenInvalid,
  onFamilyChange,
  onGivenChange,
  katakanaOnly = false,
}: {
  groupLabel: string;
  familyLabel: string;
  givenLabel: string;
  familyValue: string;
  givenValue: string;
  familyPlaceholder: string;
  givenPlaceholder: string;
  familyAutoComplete?: string;
  givenAutoComplete?: string;
  disabled: boolean;
  familyInvalid: boolean;
  givenInvalid: boolean;
  katakanaOnly?: boolean;
  onFamilyChange: (next: string) => void;
  onGivenChange: (next: string) => void;
}) {
  const invalidClass = FIELD_INVALID_CLASS;
  const familyClass = familyInvalid ? `${INPUT_CLASS} ${invalidClass}` : INPUT_CLASS;
  const givenClass = givenInvalid ? `${INPUT_CLASS} ${invalidClass}` : INPUT_CLASS;

  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-slate-600">
          {familyLabel}
        </span>
        <KatakanaAwareTextInput
          type="text"
          className={familyClass}
          value={familyValue}
          disabled={disabled}
          autoComplete={familyAutoComplete}
          placeholder={familyPlaceholder}
          katakanaOnly={katakanaOnly}
          onChange={onFamilyChange}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-slate-600">
          {givenLabel}
        </span>
        <KatakanaAwareTextInput
          type="text"
          className={givenClass}
          value={givenValue}
          disabled={disabled}
          autoComplete={givenAutoComplete}
          placeholder={givenPlaceholder}
          katakanaOnly={katakanaOnly}
          onChange={onGivenChange}
        />
      </label>
    </div>
  );
}

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
  if (field.type === "radio" && field.options?.length) {
    return (
      <div
        className={`flex flex-col gap-2 rounded-xl p-1 ${
          invalid ? "ring-2 ring-red-200" : ""
        }`}
        role="radiogroup"
        aria-label={field.label}
      >
        {field.options.map((opt) => (
          <label
            key={opt}
            className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium ${
              value === opt
                ? "border-emerald-400 bg-emerald-50 text-emerald-900"
                : "border-slate-200 bg-white text-slate-700"
            }`}
          >
            <input
              type="radio"
              name={field.key}
              className="size-4 border-slate-300 text-emerald-600"
              value={opt}
              checked={value === opt}
              disabled={disabled}
              onChange={() => onChange(opt)}
            />
            {opt}
          </label>
        ))}
      </div>
    );
  }

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

  const forceSelectList =
    AP_CL_STAFF_KEYS.has(field.key) && !field.optionsPending;

  if (
    field.type === "select" &&
    !field.optionsPending &&
    (forceSelectList || (field.options && field.options.length > 0))
  ) {
    const trimmed = value.trim();
    const baseOptions = field.options ?? [];
    const selectOptions =
      trimmed && !baseOptions.includes(trimmed)
        ? [...baseOptions, trimmed]
        : baseOptions;
    return (
      <select
        className={selectClass}
        value={value}
        disabled={disabled}
        onBlur={onBlur}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">選択してください</option>
        {selectOptions.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "decimal-kw") {
    return (
      <input
        type="text"
        inputMode="decimal"
        className={controlClass}
        value={value}
        disabled={disabled}
        placeholder="例：5.280"
        onBlur={onBlur}
        onChange={(e) => onChange(formatDecimalKwInput(e.target.value))}
      />
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

  if (field.type === "phone") {
    return (
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        className={controlClass}
        value={value}
        disabled={disabled}
        placeholder="090-1234-5678"
        maxLength={13}
        onBlur={onBlur}
        onChange={(e) => onChange(formatPhoneNumberInput(e.target.value))}
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

  const autoComplete =
    field.key === "prefecture"
      ? "address-level1"
      : field.key === "city"
        ? "address-level2"
        : field.key === "address"
          ? "street-address"
          : field.key === "customerName"
            ? "name"
            : undefined;

  return (
    <input
      type="text"
      className={controlClass}
      value={value}
      disabled={disabled}
      autoComplete={autoComplete}
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
  const [apClStaff, setApClStaff] = useState<ApClStaffPickerPayload | null>(
    null,
  );
  const [apClStaffLoading, setApClStaffLoading] = useState(false);

  const [creditCompanies, setCreditCompanies] = useState<string[]>([]);
  const [creditCompaniesLoading, setCreditCompaniesLoading] = useState(false);
  const [creditCompaniesConfigured, setCreditCompaniesConfigured] =
    useState(false);

  const [constructionContractors, setConstructionContractors] = useState<
    string[]
  >([]);
  const [constructionContractorsLoading, setConstructionContractorsLoading] =
    useState(false);
  const [constructionContractorsConfigured, setConstructionContractorsConfigured] =
    useState(false);

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

  useEffect(() => {
    if (!idToken) {
      setCreditCompanies([]);
      setCreditCompaniesLoading(false);
      setCreditCompaniesConfigured(false);
      return;
    }

    let cancelled = false;
    setCreditCompaniesLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/customer-info/credit-companies", {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = (await res.json()) as {
          options?: string[];
          configured?: boolean;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setCreditCompanies([]);
          setCreditCompaniesConfigured(false);
          return;
        }
        setCreditCompanies(data.options ?? []);
        setCreditCompaniesConfigured(data.configured !== false);
      } catch {
        if (!cancelled) {
          setCreditCompanies([]);
          setCreditCompaniesConfigured(false);
        }
      } finally {
        if (!cancelled) setCreditCompaniesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [idToken]);

  useEffect(() => {
    if (!idToken) {
      setConstructionContractors([]);
      setConstructionContractorsLoading(false);
      setConstructionContractorsConfigured(false);
      return;
    }

    let cancelled = false;
    setConstructionContractorsLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/customer-info/construction-contractors", {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = (await res.json()) as {
          options?: string[];
          configured?: boolean;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setConstructionContractors([]);
          setConstructionContractorsConfigured(false);
          return;
        }
        setConstructionContractors(data.options ?? []);
        setConstructionContractorsConfigured(data.configured !== false);
      } catch {
        if (!cancelled) {
          setConstructionContractors([]);
          setConstructionContractorsConfigured(false);
        }
      } finally {
        if (!cancelled) setConstructionContractorsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [idToken]);

  useEffect(() => {
    if (!idToken) {
      setApClStaff(null);
      setApClStaffLoading(false);
      return;
    }
    let cancelled = false;
    setApClStaffLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/customer-info/ap-cl-staff", {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = (await res.json()) as ApClStaffPickerPayload & {
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setApClStaff({
            configured: true,
            rosterEmpty: true,
            configError:
              typeof data.error === "string"
                ? data.error
                : "AP/CL担当者リストの取得に失敗しました",
            ap: { options: [], defaultName: null },
            cl: { options: [], defaultName: null },
          });
          return;
        }
        setApClStaff(data);
      } catch {
        if (!cancelled) {
          setApClStaff({
            configured: true,
            rosterEmpty: true,
            configError: "AP/CL担当者リストの取得に失敗しました（通信エラー）",
            ap: { options: [], defaultName: null },
            cl: { options: [], defaultName: null },
          });
        }
      } finally {
        if (!cancelled) setApClStaffLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idToken]);

  const propagateValues = useCallback(
    (next: CustomerInfoFormValues) => {
      for (const [k, v] of Object.entries(next)) {
        if (values[k] !== v) onChange(k, v);
      }
    },
    [onChange, values],
  );

  const visibleFields = useMemo(() => {
    return formFields
      .filter((f) => isCustomerInfoFormFieldVisible(f.key, displayValues))
      .map((f) => {
        if (f.key === "creditCompany") {
          if (
            creditCompaniesLoading ||
            !creditCompaniesConfigured ||
            creditCompanies.length === 0
          ) {
            return { ...f, options: [], optionsPending: true };
          }
          return {
            ...f,
            type: "select" as const,
            options: creditCompanies,
            optionsPending: false,
          };
        }
        if (f.key === "constructionContractor") {
          if (
            constructionContractorsLoading ||
            !constructionContractorsConfigured ||
            constructionContractors.length === 0
          ) {
            return { ...f, options: [], optionsPending: true };
          }
          return {
            ...f,
            type: "select" as const,
            options: mergeStaffNameOptions(
              constructionContractors,
              displayValues.constructionContractor,
            ),
            optionsPending: false,
          };
        }
        if (f.key === "apStaff" || f.key === "clStaff") {
          const role = f.key === "apStaff" ? "ap" : "cl";
          if (apClStaffLoading) {
            return { ...f, type: "select" as const, options: [], optionsPending: true };
          }
          const picker = apClStaff?.[role];
          return {
            ...f,
            type: "select" as const,
            options: mergeStaffNameOptions(
              picker?.options ?? [],
              displayValues[f.key],
            ),
            optionsPending: false,
          };
        }
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
    apClStaff,
    apClStaffLoading,
    creditCompanies,
    creditCompaniesLoading,
    creditCompaniesConfigured,
    constructionContractors,
    constructionContractorsLoading,
    constructionContractorsConfigured,
  ]);

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
      if (key === "panelModel2") {
        next = { ...next, panelCombo: inferPanelComboFromValues(next) };
      }
      if (
        key === "introduction" ||
        key === "paymentMethod" ||
        key === "installationType" ||
        key === "indoorSurveyStatus" ||
        key === "preApplication" ||
        key === "batteryMulti"
      ) {
        next = applyCustomerInfoHiddenDefaultsToValues(next);
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
        if (NAME_SPLIT_GIVEN_KEYS.has(field.key)) return null;

        const nameSplitGroup =
          field.key in NAME_SPLIT_GROUPS
            ? NAME_SPLIT_GROUPS[field.key as keyof typeof NAME_SPLIT_GROUPS]
            : null;
        const invalid = requiredFieldErrors?.has(field.key) ?? false;
        const givenInvalid = nameSplitGroup
          ? (requiredFieldErrors?.has(nameSplitGroup.givenKey) ?? false)
          : false;

        return (
        <label key={field.key} className="block">
          <span className="mb-1 block text-[12px] font-semibold text-slate-700">
            {nameSplitGroup?.groupLabel ?? field.label}
            {field.required !== false ? (
              <span className="ml-1 text-[11px] font-bold text-red-600">
                必須
              </span>
            ) : null}
            {field.optionsPending && !AP_CL_STAFF_KEYS.has(field.key) ? (
              <span className="ml-1 font-normal text-slate-400">
                （一覧は後日連携）
              </span>
            ) : null}
          </span>
          {nameSplitGroup ? (
            <NameSplitFieldGroup
              groupLabel={nameSplitGroup.groupLabel}
              familyLabel={nameSplitGroup.familyLabel}
              givenLabel={nameSplitGroup.givenLabel}
              familyValue={displayValues[field.key] ?? ""}
              givenValue={displayValues[nameSplitGroup.givenKey] ?? ""}
              familyPlaceholder={nameSplitGroup.familyPlaceholder}
              givenPlaceholder={nameSplitGroup.givenPlaceholder}
              familyAutoComplete={nameSplitGroup.familyAutoComplete}
              givenAutoComplete={nameSplitGroup.givenAutoComplete}
              disabled={saving}
              familyInvalid={invalid}
              givenInvalid={givenInvalid}
              katakanaOnly={field.key === "furiganaFamily"}
              onFamilyChange={(next) => handleFieldChange(field.key, next)}
              onGivenChange={(next) =>
                handleFieldChange(nameSplitGroup.givenKey, next)
              }
            />
          ) : (
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
          )}
          {invalid || givenInvalid ? (
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
            if (field.key === "apStaff" || field.key === "clStaff") {
              const roleKey = field.key === "apStaff" ? "ap" : "cl";
              const roleLabel = field.key === "apStaff" ? "AP" : "CL";
              return (
                <p
                  className={`mt-1 text-[11px] leading-relaxed ${
                    apClStaff?.configError
                      ? "font-semibold text-amber-800"
                      : "text-slate-500"
                  }`}
                >
                  {apClStaffLoading
                    ? `${roleLabel}担当者一覧を読み込み中…`
                    : apClStaff?.configError
                      ? apClStaff.configError
                      : apClStaff?.configured
                        ? apClStaff.rosterEmpty
                          ? "スタッフ名簿を取得できませんでした。しばらくしてから画面を更新してください。"
                          : (apClStaff[roleKey].options.length === 0
                              ? `「稼働」の${roleLabel}担当者が名簿にいません。AP/CL稼働状況の値を確認してください。`
                              : `スタッフ名簿の${roleLabel}稼働状況が「稼働」の社員から選択`)
                        : "スタッフ名簿の設定（STAFF_APP_ID・氏名列・AP/CL稼働状況・LINE_USER_ID①②の環境変数）を確認してください"}
                </p>
              );
            }
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
