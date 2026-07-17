"use client";

import { useMemo, useState } from "react";

import {
  commitStaffNameInput,
  filterStaffNameSuggestions,
  isExactStaffName,
} from "@/lib/staff-name-options";

const DEFAULT_INPUT_CLASS =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 shadow-inner outline-none ring-1 ring-slate-100 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-200";

const FIELD_INVALID_CLASS =
  "border-red-400 ring-2 ring-red-200 focus:border-red-400 focus:ring-red-200";

/** スタッフ名の入力＋候補サジェスト（完全一致のみ有効） */
export function StaffNameSuggestCombobox({
  id,
  label,
  value,
  options,
  disabled,
  invalid,
  loading,
  inputClassName = DEFAULT_INPUT_CLASS,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: string[];
  disabled?: boolean;
  invalid?: boolean;
  loading?: boolean;
  inputClassName?: string;
  placeholder?: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = `${id}-suggestions`;
  const exact = isExactStaffName(options, value);
  const showMismatch = Boolean(value.trim()) && options.length > 0 && !exact;
  const controlClass =
    invalid || showMismatch
      ? `${inputClassName} ${FIELD_INVALID_CLASS}`
      : inputClassName;

  const suggestions = useMemo(
    () => filterStaffNameSuggestions(options, value),
    [options, value],
  );

  function commitCurrentInput() {
    const committed = commitStaffNameInput(options, value);
    if (committed !== value) onChange(committed);
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || showMismatch}
        className={controlClass}
        value={value}
        disabled={disabled}
        placeholder={
          placeholder ??
          (loading ? "一覧を読み込み中…" : "名前を入力または候補から選択")
        }
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          const next = e.relatedTarget as HTMLElement | null;
          if (next?.closest(`#${CSS.escape(listId)}`)) return;
          commitCurrentInput();
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const top = suggestions[0];
          if (top) {
            onChange(top);
            setOpen(false);
            return;
          }
          commitCurrentInput();
        }}
      />
      {open && !disabled && suggestions.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-900"
        >
          {suggestions.map((opt) => (
            <li key={opt} role="option">
              <button
                type="button"
                className={`flex w-full px-3 py-2 text-left text-[13px] transition hover:bg-emerald-50 dark:hover:bg-emerald-950/40 ${
                  isExactStaffName([opt], value)
                    ? "bg-emerald-50 font-semibold text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100"
                    : "text-slate-800 dark:text-slate-100"
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
              >
                {opt}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {showMismatch ? (
        <p className="mt-1 text-[11px] font-semibold text-red-600">
          スタッフ名を候補から選んでください（Enter で先頭候補を確定）
        </p>
      ) : null}
    </div>
  );
}
