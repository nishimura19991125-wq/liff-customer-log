"use client";

import {
  formatSalesProgressNumber,
  formatSalesProgressRate,
  type SalesProgressMetric,
} from "@/lib/sales-progress-aggregate";

/**
 * 達成率のバー（タスクK-5）。
 *
 * グラフライブラリは入れず CSS だけで描く。100%超は塗り幅を100%で頭打ちに
 * するが、数値はそのまま出す（バーが枠から出ないようにするため）。
 * 目標が0または未設定なら達成率は「—」。
 */

const TONE = {
  self: "bg-emerald-500",
  company: "bg-sky-500",
  branch: "bg-slate-400",
} as const;

export function SalesProgressBar({
  label,
  metric,
  unit,
  tone = "company",
}: {
  label: string;
  metric: SalesProgressMetric;
  /** 件数系は「件」、PT は付けない */
  unit?: string;
  tone?: keyof typeof TONE;
}) {
  const rateLabel = formatSalesProgressRate(metric.ratePercent);
  const actual = formatSalesProgressNumber(metric.actual);
  const target = formatSalesProgressNumber(metric.target);
  const suffix = unit ?? "";

  return (
    <div className="mt-3 first:mt-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">
          {label}
        </span>
        <span className="text-[13px] font-bold tabular-nums text-slate-900 dark:text-white">
          {actual}
          {suffix}
          <span className="mx-1 font-normal text-slate-400">/</span>
          <span className="font-semibold text-slate-500 dark:text-slate-400">
            {target}
            {suffix}
          </span>
        </span>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <div
          role="progressbar"
          aria-label={`${label}の達成率`}
          aria-valuenow={metric.ratePercent ?? 0}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={rateLabel}
          className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
        >
          <div
            className={`h-full rounded-full transition-[width] ${TONE[tone]}`}
            style={{ width: `${metric.barPercent}%` }}
          />
        </div>
        <span className="w-16 shrink-0 text-right text-[13px] font-black tabular-nums text-slate-800 dark:text-slate-100">
          {rateLabel}
        </span>
      </div>
    </div>
  );
}
