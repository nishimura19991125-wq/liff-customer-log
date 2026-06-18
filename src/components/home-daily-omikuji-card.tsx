"use client";

import { useEffect, useMemo, useState } from "react";

import { FortuneDetailPartsList } from "@/components/fortune-detail-parts-list";
import {
  DAILY_OMIKUJI_SHOWN_EVENT,
  isDailyOmikujiShownToday,
} from "@/lib/daily-omikuji-shown";
import { buildDailyBusinessFortuneView } from "@/lib/home-business-fortune";

type Props = {
  staffName: string | null;
};

const RANK_STYLES: Record<string, string> = {
  超大吉: "bg-amber-400 text-red-900",
  大吉: "bg-red-500 text-white",
  中吉: "bg-orange-500 text-white",
  小吉: "bg-emerald-500 text-white",
  吉: "bg-sky-500 text-white",
  凶: "bg-slate-400 text-white",
  大凶: "bg-slate-700 text-slate-100",
};

function parseRank(headline: string): { rank: string; body: string } {
  const match = headline.match(/^【(.+?)】(.+)$/);
  if (!match) return { rank: "吉", body: headline };
  return { rank: match[1]!, body: match[2]!.trim() };
}

function useOmikujiShownToday(staffName: string | null): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const sync = () => {
      if (!staffName?.trim()) {
        setShown(false);
        return;
      }
      setShown(isDailyOmikujiShownToday(staffName));
    };

    sync();
    window.addEventListener(DAILY_OMIKUJI_SHOWN_EVENT, sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(DAILY_OMIKUJI_SHOWN_EVENT, sync);
      window.removeEventListener("focus", sync);
    };
  }, [staffName]);

  return shown;
}

export function HomeDailyOmikujiCard({ staffName }: Props) {
  const shownToday = useOmikujiShownToday(staffName);
  const fortune = useMemo(
    () => buildDailyBusinessFortuneView(staffName ?? ""),
    [staffName],
  );
  const { rank, body } = parseRank(fortune.headline);
  const rankStyle =
    RANK_STYLES[rank] ?? "bg-amber-400 text-red-900";

  if (!shownToday || !staffName?.trim()) return null;

  return (
    <section
      className="mt-4 overflow-hidden rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50 to-orange-50 shadow-sm dark:border-amber-800/40 dark:from-amber-950/30 dark:to-slate-900"
      aria-label="今日のおみくじ"
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        <span
          className={`mt-0.5 shrink-0 rounded-lg px-2 py-1 text-[13px] font-black tracking-wide ${rankStyle}`}
        >
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-amber-800/80 dark:text-amber-300/80">
            今日のおみくじ · {fortune.dateLabel}
          </p>
          <p className="mt-1 text-[14px] font-semibold leading-snug text-slate-800 dark:text-slate-100">
            {body}
          </p>
          <FortuneDetailPartsList
            detailLine={fortune.detailLine}
            variant="card"
          />
        </div>
      </div>
    </section>
  );
}
