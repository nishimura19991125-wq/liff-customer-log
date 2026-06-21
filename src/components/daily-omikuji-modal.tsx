"use client";

import type { ReactNode } from "react";

import { FortuneDetailPartsList } from "@/components/fortune-detail-parts-list";
import type { DailyFortuneView } from "@/lib/home-business-fortune";

type DailyOmikujiModalProps = {
  fortune: DailyFortuneView;
  footer: ReactNode;
};

const RANK_STYLES: Record<string, string> = {
  超大吉:
    "bg-gradient-to-br from-amber-400 via-yellow-300 to-orange-400 text-red-900 shadow-amber-500/40",
  大吉: "bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-red-500/30",
  中吉: "bg-gradient-to-br from-orange-400 to-amber-500 text-white shadow-orange-500/30",
  小吉: "bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-emerald-500/30",
  吉: "bg-gradient-to-br from-sky-400 to-cyan-500 text-white shadow-sky-500/30",
  凶: "bg-gradient-to-br from-slate-400 to-slate-500 text-white shadow-slate-500/30",
  大凶: "bg-gradient-to-br from-slate-600 to-slate-800 text-slate-100 shadow-slate-700/40",
};

function parseRank(headline: string): { rank: string; body: string } {
  const match = headline.match(/^【(.+?)】(.+)$/);
  if (!match) return { rank: "吉", body: headline };
  return { rank: match[1]!, body: match[2]!.trim() };
}

export function DailyOmikujiModal({ fortune, footer }: DailyOmikujiModalProps) {
  const { rank, body } = parseRank(fortune.headline);
  const rankStyle =
    RANK_STYLES[rank] ??
    "bg-gradient-to-br from-amber-300 to-orange-400 text-red-900 shadow-amber-500/30";

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="daily-omikuji-title"
    >
      <div className="relative w-full max-w-sm">
        <div className="overflow-hidden rounded-2xl border-2 border-amber-700/30 bg-gradient-to-b from-amber-50 to-orange-50 shadow-2xl dark:border-amber-600/20 dark:from-slate-800 dark:to-slate-900">
          <div className="border-b border-amber-200/80 bg-amber-100/80 px-4 py-3 text-center dark:border-amber-800/40 dark:bg-amber-950/40">
            <p className="text-xs font-medium tracking-widest text-amber-800/80 dark:text-amber-300/80">
              今日のおみくじ
            </p>
            <p
              id="daily-omikuji-title"
              className="mt-0.5 text-sm text-amber-900/70 dark:text-amber-200/70"
            >
              {fortune.dateLabel} · {fortune.whoLabel}
            </p>
          </div>

          <div className="px-5 py-6">
            <div className="flex justify-center">
              <div
                className={`flex size-28 items-center justify-center rounded-full text-3xl font-black tracking-wider shadow-lg ${rankStyle}`}
              >
                {rank}
              </div>
            </div>

            <p className="mt-5 text-center text-[15px] font-semibold leading-relaxed text-slate-800 dark:text-slate-100">
              {body}
            </p>

            <FortuneDetailPartsList detailLine={fortune.detailLine} />
          </div>

          <div className="border-t border-amber-200/80 px-4 py-4 dark:border-amber-800/40">
            {footer}
          </div>
        </div>
      </div>
    </div>
  );
}
