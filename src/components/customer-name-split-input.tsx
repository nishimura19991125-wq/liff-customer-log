"use client";

const INPUT_CLASS =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 shadow-inner outline-none ring-1 ring-slate-100 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-200";

const FIELD_INVALID_CLASS =
  "border-red-300 ring-2 ring-red-200 focus:border-red-400 focus:ring-red-200";

export type CustomerNameSplitInputProps = {
  groupLabel: string;
  familyValue: string;
  givenValue: string;
  onFamilyChange: (next: string) => void;
  onGivenChange: (next: string) => void;
  disabled?: boolean;
  required?: boolean;
  familyInvalid?: boolean;
  givenInvalid?: boolean;
  familyLabel?: string;
  givenLabel?: string;
  familyPlaceholder?: string;
  givenPlaceholder?: string;
  familyAutoComplete?: string;
  givenAutoComplete?: string;
  inputClassName?: string;
};

export function CustomerNameSplitInput({
  groupLabel,
  familyValue,
  givenValue,
  onFamilyChange,
  onGivenChange,
  disabled = false,
  required = false,
  familyInvalid = false,
  givenInvalid = false,
  familyLabel = "苗字",
  givenLabel = "名前",
  familyPlaceholder = "例：山田",
  givenPlaceholder = "例：太郎",
  familyAutoComplete = "family-name",
  givenAutoComplete = "given-name",
  inputClassName = INPUT_CLASS,
}: CustomerNameSplitInputProps) {
  const familyClass = familyInvalid
    ? `${inputClassName} ${FIELD_INVALID_CLASS}`
    : inputClassName;
  const givenClass = givenInvalid
    ? `${inputClassName} ${FIELD_INVALID_CLASS}`
    : inputClassName;

  return (
    <div>
      <span className="mb-1 block text-[12px] font-semibold text-slate-700">
        {groupLabel}
        {required ? (
          <span className="ml-1 text-[11px] font-bold text-red-600">必須</span>
        ) : null}
      </span>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-slate-600">
            {familyLabel}
          </span>
          <input
            type="text"
            className={familyClass}
            value={familyValue}
            disabled={disabled}
            autoComplete={familyAutoComplete}
            placeholder={familyPlaceholder}
            onChange={(e) => onFamilyChange(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-slate-600">
            {givenLabel}
          </span>
          <input
            type="text"
            className={givenClass}
            value={givenValue}
            disabled={disabled}
            autoComplete={givenAutoComplete}
            placeholder={givenPlaceholder}
            onChange={(e) => onGivenChange(e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}

export function isFuriganaFieldLabel(label: string): boolean {
  return label.normalize("NFKC").trim().includes("フリガナ");
}

export function isCustomerNameFieldLabel(label: string): boolean {
  const t = label.normalize("NFKC").trim();
  return t.includes("お客様名") || t === "顧客名" || t === "氏名";
}
