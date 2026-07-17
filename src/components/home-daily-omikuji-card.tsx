"use client";

import { useEffect, useMemo, useState } from "react";

import { FortuneDetailPartsList } from "@/components/fortune-detail-parts-list";
import { parseFortuneHeadline } from "@/components/fortune-rank-badge";
import { useDailyOmikujiShownToday } from "@/hooks/use-daily-omikuji-shown-today";
import {
  buildDailyBusinessFortuneView,
  type DailyFortuneBuildContext,
} from "@/lib/home-business-fortune";

type Props = {
  staffName: string | null;
  department?: string | null;
  staffRole?: "ap" | "cl" | null;
};

export function HomeDailyOmikujiCard({
  staffName,
  department = null,
  staffRole = null,
}: Props) {
  const shownToday = useDailyOmikujiShownToday(staffName);
  const [expanded, setExpanded] = useState(false);
  const fortuneCtx = useMemo<DailyFortuneBuildContext>(
    () => ({ department, staffRole }),
    [department, staffRole],
  );
  const fortune = useMemo(
    () => buildDailyBusinessFortuneView(staffName ?? "", fortuneCtx),
    [staffName, fortuneCtx],
  );
  const { body } = parseFortuneHeadline(fortune.headline);

  useEffect(() => {
    setExpanded(false);
  }, [staffName, fortune.dateLabel]);

  if (!shownToday || !staffName?.trim()) return null;

  return (
    <section
      className="overflow-hidden rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50 to-orange-50 shadow-sm dark:border-amber-800/40 dark:from-amber-950/30 dark:to-slate-900"
      aria-label="今日のおみくじ"
    >
      <div className="px-4 py-3.5">
        <p className="text-[12px] font-medium text-amber-800/80 dark:text-amber-300/80">
          今日のおみくじ · {fortune.dateLabel}
        </p>
        {expanded ? (
          <>
            <p className="mt-1 text-[14px] font-semibold leading-snug text-slate-800 dark:text-slate-100">
              {body}
            </p>
            <FortuneDetailPartsList
              detailLine={fortune.detailLine}
              variant="card"
            />
          </>
        ) : null}
        <button
          type="button"
          className="mt-2 text-[12px] font-bold text-amber-800 underline-offset-2 transition hover:underline dark:text-amber-300"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "閉じる" : "もっと見る"}
        </button>
      </div>
    </section>
  );
}
