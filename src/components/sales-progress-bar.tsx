"use client";

import {
  formatSalesProgressNumber,
  formatSalesProgressRate,
  type SalesProgressMetric,
} from "@/lib/sales-progress-aggregate";

/**
 * 達成率のバー（タスクK-5 / L-2）。
 *
 * グラフライブラリは入れず CSS だけで描く。100%超は塗り幅を100%で頭打ちに
 * するが、数値はそのまま出す（バーが枠から出ないようにするため）。
 * 目標が0または未設定なら達成率は「—」。
 *
 * タスクL で、数字の下に細く敷く形（compact）を足した。支社1件あたり
 * 縦4行を使っていて、5支社見るのに大量のスクロールが必要だったため。
 * 色は既存の配色（emerald / sky / slate）に揃えており、新しい色は使わない。
 */

const TONE = {
  self: "bg-emerald-500 dark:bg-emerald-400",
  company: "bg-sky-500 dark:bg-sky-400",
  branch: "bg-slate-400 dark:bg-slate-400",
} as const;

export type SalesProgressBarTone = keyof typeof TONE;

/** バーだけ。数字は呼び出し側が並べる（表形式に寄せるため） */
export function SalesProgressBarTrack({
  label,
  metric,
  tone = "company",
  thin = false,
}: {
  /** 読み上げ用。画面には出さない */
  label: string;
  metric: SalesProgressMetric;
  tone?: SalesProgressBarTone;
  /** 細いバー（支社別・内訳用） */
  thin?: boolean;
}) {
  return (
    <div
      role="progressbar"
      aria-label={`${label}の達成率`}
      aria-valuenow={metric.ratePercent ?? 0}
      aria-valuemin={0}
      aria-valuemax={100}
      // 「—」も読み上げられるようにする。aria-valuenow は数値しか取れない
      aria-valuetext={formatSalesProgressRate(metric.ratePercent)}
      className={`w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700 ${
        thin ? "h-1" : "h-2"
      }`}
    >
      <div
        className={`h-full rounded-full transition-[width] ${TONE[tone]}`}
        style={{ width: `${metric.barPercent}%` }}
      />
    </div>
  );
}

/**
 * 1行に「見出し・実績/目標・達成率」を並べ、その下に細いバーを敷く。
 * 支社別と内訳はこの形に揃える。
 */
export function SalesProgressRow({
  label,
  metric,
  unit,
  tone = "branch",
  sub,
  emphasis = false,
}: {
  label: string;
  metric: SalesProgressMetric;
  /** 件数系は「件」、PT は付けない */
  unit?: string;
  tone?: SalesProgressBarTone;
  /** 見出しの右に小さく出す補足（人数など） */
  sub?: string;
  /** 本人の行など、少し強めに見せる */
  emphasis?: boolean;
}) {
  const suffix = unit ?? "";
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span
            className={`truncate text-[13px] ${
              emphasis
                ? "font-bold text-emerald-800 dark:text-emerald-300"
                : "font-semibold text-slate-800 dark:text-slate-100"
            }`}
          >
            {label}
          </span>
          {/* 補足はダークでも暗くしない。既存画面と同じく暗い側では明るくする */}
          {sub ? (
            <span className="shrink-0 text-[11px] text-slate-400 dark:text-slate-400">
              {sub}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-right text-[12px] tabular-nums text-slate-600 dark:text-slate-300">
          <span className="font-bold text-slate-900 dark:text-white">
            {formatSalesProgressNumber(metric.actual)}
            {suffix}
          </span>
          <span className="mx-1 text-slate-400">/</span>
          {formatSalesProgressNumber(metric.target)}
          {suffix}
          <span className="ml-2 inline-block w-14 text-right font-black text-slate-800 dark:text-slate-100">
            {formatSalesProgressRate(metric.ratePercent)}
          </span>
        </span>
      </div>
      <div className="mt-1">
        <SalesProgressBarTrack label={label} metric={metric} tone={tone} thin />
      </div>
    </div>
  );
}

/** 「自分の数字」「全体の進捗」用。数字を大きめに出す */
export function SalesProgressHeadline({
  label,
  metric,
  unit,
  tone = "company",
  targetKnown,
}: {
  label: string;
  metric: SalesProgressMetric;
  unit?: string;
  tone?: SalesProgressBarTone;
  /** false なら実績だけを大きく出す（0 / 0 と「—」を並べても意味がないため） */
  targetKnown: boolean;
}) {
  const suffix = unit ?? "";

  if (!targetKnown) {
    return (
      <div className="flex items-baseline justify-between gap-3 py-1.5">
        <span className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">
          {label}
        </span>
        <span className="text-[20px] font-black tabular-nums leading-none text-slate-900 dark:text-white">
          {formatSalesProgressNumber(metric.actual)}
          <span className="ml-0.5 text-[13px] font-bold">{suffix}</span>
        </span>
      </div>
    );
  }

  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">
          {label}
        </span>
        <span className="text-right tabular-nums">
          <span className="text-[18px] font-black leading-none text-slate-900 dark:text-white">
            {formatSalesProgressNumber(metric.actual)}
            {suffix}
          </span>
          <span className="mx-1 text-[12px] text-slate-400">/</span>
          <span className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">
            {formatSalesProgressNumber(metric.target)}
            {suffix}
          </span>
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <SalesProgressBarTrack label={label} metric={metric} tone={tone} />
        <span className="w-14 shrink-0 text-right text-[13px] font-black tabular-nums text-slate-800 dark:text-slate-100">
          {formatSalesProgressRate(metric.ratePercent)}
        </span>
      </div>
    </div>
  );
}
