"use client";

import {
  APO_LIST_SCOPES,
  APO_LIST_SCOPE_LABELS,
  type ApoListScope,
} from "@/lib/apo-list-filter";

type Props = {
  value: ApoListScope;
  onChange: (scope: ApoListScope) => void;
};

/**
 * 進行中／すべての切り替え。
 * タップ領域は 44px 四方を目安にする（指で押す画面のため）
 */
const tabBase =
  "min-h-[44px] min-w-[44px] flex-1 rounded-xl px-4 text-[14px] font-semibold transition";

export function ApoListScopeTabs({ value, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="アポ情報の絞り込み"
      className="flex gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800"
    >
      {APO_LIST_SCOPES.map((scope) => {
        const selected = scope === value;
        return (
          <button
            key={scope}
            type="button"
            role="tab"
            id={`apo-list-tab-${scope}`}
            aria-selected={selected}
            aria-controls="apo-list-panel"
            onClick={() => onChange(scope)}
            className={`${tabBase} ${
              selected
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white"
                : "text-slate-500 dark:text-slate-400"
            }`}
          >
            {APO_LIST_SCOPE_LABELS[scope]}
          </button>
        );
      })}
    </div>
  );
}
