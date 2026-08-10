"use client";

import { useId } from "react";

import type {
  CalendarDisplayMode,
  CalendarEmptySlotSummary,
} from "@/lib/calendar-contractor-filter";
import {
  CALENDAR_DISPLAY_MODE_LABELS,
  formatCalendarEmptySlotSummary,
} from "@/lib/calendar-contractor-filter";

/**
 * 工事カレンダーの施工店フィルタと表示モード（タスクI）。
 *
 * liff-calendar-month-page.tsx が3,000行を超えているため別コンポーネントに
 * 切り出し、ページ側は状態の受け渡しだけを行う。
 *
 * 設定は記憶しない。画面を開き直すたびに全社チェック・「すべて」に戻る
 * （localStorage / sessionStorage は使わない）。
 */
export function CalendarContractorFilterPanel({
  contractorKeys,
  selectedContractors,
  summaries,
  mode,
  visibleCount,
  onToggleContractor,
  onSelectAll,
  onClearAll,
  onChangeMode,
}: {
  /** 表示中の月に出ている施工会社（未設定を含む） */
  contractorKeys: readonly string[];
  selectedContractors: ReadonlySet<string>;
  /** 施工会社ごとの残り空き枠数と最短日 */
  summaries: readonly CalendarEmptySlotSummary[];
  mode: CalendarDisplayMode;
  /** フィルタ適用後の表示件数（読み上げ用） */
  visibleCount: number;
  onToggleContractor: (contractorKey: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onChangeMode: (mode: CalendarDisplayMode) => void;
}) {
  const modeGroupId = useId();
  const summaryByKey = new Map(summaries.map((s) => [s.contractorKey, s]));

  if (contractorKeys.length === 0) return null;

  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-800/95">
      <fieldset>
        <legend className="text-[12px] font-bold text-slate-700 dark:text-slate-100">
          表示する施工店
        </legend>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={onSelectAll}
            className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:border-slate-600 dark:text-slate-200"
          >
            すべて選択
          </button>
          <button
            type="button"
            onClick={onClearAll}
            className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:border-slate-600 dark:text-slate-200"
          >
            すべて解除
          </button>
        </div>

        <ul className="mt-2 flex flex-col gap-1">
          {contractorKeys.map((key) => {
            const summary = summaryByKey.get(key);
            const checked = selectedContractors.has(key);
            return (
              <li key={key}>
                <label className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-[13px] text-slate-800 dark:text-slate-100">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 border-slate-300 text-emerald-600"
                    checked={checked}
                    onChange={() => onToggleContractor(key)}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {summary?.label ?? key}
                  </span>
                  {/* 空き枠サマリ。表示モードに関わらず常に出す */}
                  <span
                    className={`shrink-0 text-[11px] font-semibold ${
                      summary && summary.count > 0
                        ? "text-emerald-800 dark:text-emerald-300"
                        : "text-slate-400 dark:text-slate-500"
                    }`}
                  >
                    {summary
                      ? formatCalendarEmptySlotSummary(summary)
                      : "残りなし"}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div
        className="mt-3"
        role="radiogroup"
        aria-labelledby={`${modeGroupId}-label`}
      >
        <p
          id={`${modeGroupId}-label`}
          className="text-[12px] font-bold text-slate-700 dark:text-slate-100"
        >
          表示するもの
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {CALENDAR_DISPLAY_MODE_LABELS.map((opt) => (
            <label
              key={opt.value}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium ${
                mode === opt.value
                  ? "border-emerald-400 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
                  : "border-slate-200 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              }`}
            >
              <input
                type="radio"
                name={`${modeGroupId}-mode`}
                className="size-3.5 border-slate-300 text-emerald-600"
                value={opt.value}
                checked={mode === opt.value}
                onChange={() => onChangeMode(opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      {/* 要素は出し入れせず常に置き、読み上げの取りこぼしを防ぐ */}
      <p
        aria-live="polite"
        className="mt-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400"
      >
        {`カレンダーの表示件数 ${visibleCount}件`}
      </p>
    </div>
  );
}
