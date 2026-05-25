"use client";

import { useEffect, useMemo, useState } from "react";

import { buildDailyBusinessFortuneLine } from "@/lib/home-business-fortune";
import {
  fetchHomeWeatherOpenMeteo,
  formatHomeWeatherMarqueeLine,
  homeWeatherDefaultCoordinates,
} from "@/lib/home-weather-open-meteo";

type Props = {
  staffName: string | null;
  className?: string;
};

function resolveCoordinates(): Promise<{ lat: number; lon: number }> {
  const fallback = homeWeatherDefaultCoordinates();

  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(fallback);
  }

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), 4000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(timer);
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        });
      },
      () => {
        window.clearTimeout(timer);
        resolve(fallback);
      },
      { enableHighAccuracy: false, timeout: 3500, maximumAge: 600_000 },
    );
  });
}

/** 天気＋日替わりビジネス占いの流れるテロップ（メモリ内のみ・永続ストレージ不使用） */
export function NewsMarquee({ staffName, className = "" }: Props) {
  const [weatherLine, setWeatherLine] = useState(() =>
    formatHomeWeatherMarqueeLine(null, true, false),
  );

  const fortuneLine = useMemo(
    () => buildDailyBusinessFortuneLine(staffName ?? ""),
    [staffName],
  );

  const marqueeText = `${weatherLine}${fortuneLine}`;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setWeatherLine(formatHomeWeatherMarqueeLine(null, true, false));
      try {
        const { lat, lon } = await resolveCoordinates();
        const weather = await fetchHomeWeatherOpenMeteo(lat, lon);
        if (cancelled) return;
        setWeatherLine(formatHomeWeatherMarqueeLine(weather, false, false));
      } catch {
        if (!cancelled) {
          setWeatherLine(formatHomeWeatherMarqueeLine(null, false, true));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      className={`news-marquee-shell overflow-hidden border-y border-purple-200/90 bg-purple-50/95 backdrop-blur-sm dark:border-purple-500/30 dark:bg-slate-900/80 ${className}`.trim()}
      aria-label="リアルタイム天気予報と今日のビジネス占い"
    >
      <div className="news-marquee-viewport relative flex h-9 items-center overflow-hidden sm:h-10">
        <div className="news-marquee-track flex min-w-max items-center gap-16 whitespace-nowrap px-4 text-[13px] font-medium tracking-wide text-purple-900 sm:text-[14px] dark:text-purple-400">
          <span className="news-marquee-glow">{marqueeText}</span>
          <span className="news-marquee-glow" aria-hidden>
            {marqueeText}
          </span>
        </div>
      </div>
    </section>
  );
}
