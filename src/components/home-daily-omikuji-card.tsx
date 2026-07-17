"use client";

import { useMemo } from "react";

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
  /** ヘッダーの「もっと見る」から制御。false のときは非表示 */
  expanded: boolean;
};

export function HomeDailyOmikujiCard({
  staffName,
  department = null,
  staffRole = null,
  expanded,
}: Props) {
  const shownToday = useDailyOmikujiShownToday(staffName);
  const fortuneCtx = useMemo<DailyFortuneBuildContext>(
    () => ({ department, staffRole }),
    [department, staffRole],
  );
  const fortune = useMemo(
    () => buildDailyBusinessFortuneView(staffName ?? "", fortuneCtx),
    [staffName, fortuneCtx],
  );
  const { body } = parseFortuneHeadline(fortune.headline);

  if (!expanded || !shownToday || !staffName?.trim()) return null;

  return (
    <section
      id="home-daily-omikuji"
      className="overflow-hidden rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50 to-orange-50 shadow-sm dark:border-amber-800/40 dark:from-amber-950/30 dark:to-slate-900"
      aria-label="今日のおみくじ"
    >
      <div className="px-4 py-3.5">
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
    </section>
  );
}
