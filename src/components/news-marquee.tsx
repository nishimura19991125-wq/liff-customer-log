"use client";

import { useMemo } from "react";

import { useMarqueeWeather } from "@/hooks/use-marquee-weather";
import { buildDailyBusinessFortuneLine } from "@/lib/home-business-fortune";

type Props = {
  staffName: string | null;
  className?: string;
};

/** 天気（GPS連動）＋日替わりビジネス占いの流れるテロップ（メモリ内のみ） */
export function NewsMarquee({ staffName, className = "" }: Props) {
  const weatherLine = useMarqueeWeather();

  const fortuneLine = useMemo(
    () => buildDailyBusinessFortuneLine(staffName ?? ""),
    [staffName],
  );

  const marqueeText = `${weatherLine}${fortuneLine}`;

  return (
    <section
      className={`news-marquee-shell overflow-hidden border-y border-purple-200/90 bg-purple-50/95 backdrop-blur-sm dark:border-purple-500/30 dark:bg-slate-900/80 ${className}`.trim()}
      aria-label="リアルタイム天気予報と今日のビジネス占い"
    >
      <div className="news-marquee-viewport relative flex h-9 items-center overflow-hidden sm:h-10">
        <div className="news-marquee-track flex min-w-max items-center gap-16 whitespace-nowrap px-4 text-[13px] font-medium tracking-wide text-purple-900 sm:text-[14px] dark:text-purple-300">
          <span className="news-marquee-glow">{marqueeText}</span>
          <span className="news-marquee-glow" aria-hidden>
            {marqueeText}
          </span>
        </div>
      </div>
    </section>
  );
}
