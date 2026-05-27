"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import { useMarqueeWeather } from "@/hooks/use-marquee-weather";
import { buildDailyBusinessFortuneView } from "@/lib/home-business-fortune";

type Props = {
  staffName: string | null;
  className?: string;
};

/** 天気（GPS連動）＋日替わりビジネス占いの流れるテロップ（メモリ内のみ） */
export function NewsMarquee({ staffName, className = "" }: Props) {
  const weather = useMarqueeWeather();

  const fortune = useMemo(
    () => buildDailyBusinessFortuneView(staffName ?? ""),
    [staffName],
  );

  const firstLine = `📍 [${weather.heading}] ${weather.conditionText} ｜ ${fortune.headline}${
    weather.rainAdvice ? ` ｜ ${weather.rainAdvice}` : ""
  }`;
  const secondLine = fortune.detailLine;

  const segmentRef = useRef<HTMLDivElement | null>(null);
  const [segmentWidth, setSegmentWidth] = useState(0);
  const [offsetX, setOffsetX] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const rafRef = useRef<number | null>(null);
  const prevTsRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const longPressRef = useRef(false);
  const touchDragRef = useRef<{
    active: boolean;
    pointerId: number;
    lastClientX: number;
  } | null>(null);

  useEffect(() => {
    const update = () => {
      const w = segmentRef.current?.offsetWidth ?? 0;
      setSegmentWidth(w);
      if (w > 0) {
        setOffsetX((prev) => {
          const normalized = prev % w;
          return normalized > 0 ? normalized - w : normalized;
        });
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [firstLine, secondLine]);

  useEffect(() => {
    const speed = 40; // px / sec
    const tick = (ts: number) => {
      const prev = prevTsRef.current ?? ts;
      prevTsRef.current = ts;
      const dt = (ts - prev) / 1000;
      if (!isPaused && !isDragging && segmentWidth > 0) {
        setOffsetX((prevX) => {
          let next = prevX - speed * dt;
          if (Math.abs(next) >= segmentWidth) {
            next += segmentWidth * Math.ceil(Math.abs(next) / segmentWidth);
          }
          return next;
        });
      }
      rafRef.current = window.requestAnimationFrame(tick);
    };
    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      prevTsRef.current = null;
    };
  }, [isPaused, isDragging, segmentWidth]);

  const clearHoldTimer = () => {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const handlePointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType !== "touch") return;
    clearHoldTimer();
    longPressRef.current = false;
    touchDragRef.current = {
      active: true,
      pointerId: e.pointerId,
      lastClientX: e.clientX,
    };
    holdTimerRef.current = window.setTimeout(() => {
      longPressRef.current = true;
      setIsPaused(true);
    }, 280);
  };

  const handlePointerMove = (e: PointerEvent<HTMLElement>) => {
    const drag = touchDragRef.current;
    if (!drag || !drag.active || drag.pointerId !== e.pointerId) return;
    const deltaX = e.clientX - drag.lastClientX;
    if (Math.abs(deltaX) > 1) {
      clearHoldTimer();
      setIsDragging(true);
      setIsPaused(true);
      setOffsetX((prev) => prev + deltaX);
      drag.lastClientX = e.clientX;
    }
  };

  const endTouchInteraction = (pointerId: number) => {
    const drag = touchDragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    clearHoldTimer();
    touchDragRef.current = null;
    const wasLongPress = longPressRef.current;
    longPressRef.current = false;
    setIsDragging(false);
    if (wasLongPress) {
      setIsPaused(false);
      return;
    }
    setIsPaused(false);
  };

  return (
    <section
      className={`news-marquee-shell overflow-hidden border-y border-purple-200/90 bg-purple-50/95 backdrop-blur-sm dark:border-purple-500/30 dark:bg-slate-900/80 ${className}`.trim()}
      aria-label="リアルタイム天気予報と今日のビジネス占い"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => endTouchInteraction(e.pointerId)}
      onPointerCancel={(e) => endTouchInteraction(e.pointerId)}
    >
      <div className="news-marquee-viewport relative overflow-hidden py-1.5 sm:py-2">
        <div
          className="news-marquee-js-track flex min-w-max items-center gap-6 px-4 text-[12px] font-medium tracking-wide text-purple-900 sm:text-[13px] dark:text-purple-300"
          style={{ transform: `translateX(${offsetX}px)` }}
        >
          <div
            ref={segmentRef}
            className="news-marquee-card min-w-max whitespace-nowrap rounded-lg border border-purple-200/60 bg-white/80 px-3 py-1 dark:border-purple-500/30 dark:bg-slate-900/70"
          >
            <p className="news-marquee-glow">{firstLine}</p>
            <p className="news-marquee-glow mt-0.5 text-purple-800 dark:text-purple-400">
              {secondLine}
            </p>
          </div>
          <div
            className="news-marquee-card min-w-max whitespace-nowrap rounded-lg border border-purple-200/60 bg-white/80 px-3 py-1 dark:border-purple-500/30 dark:bg-slate-900/70"
            aria-hidden
          >
            <p className="news-marquee-glow">{firstLine}</p>
            <p className="news-marquee-glow mt-0.5 text-purple-800 dark:text-purple-400">
              {secondLine}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
