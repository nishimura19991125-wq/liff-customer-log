"use client";

import { useEffect, useState } from "react";

import {
  fetchHomeWeatherOpenMeteo,
  formatHomeWeatherMarqueeLine,
  homeWeatherCompanyCoordinates,
  type WeatherLocationSource,
} from "@/lib/home-weather-open-meteo";

export type MarqueeWeatherCoords = {
  lat: number;
  lon: number;
  source: WeatherLocationSource;
};

const GEO_TIMEOUT_MS = 4500;

/** GPS 取得 → 失敗時は奈良（会社周辺）へ。座標はメモリ内のみ（永続化しない） */
export function resolveMarqueeWeatherCoords(): Promise<MarqueeWeatherCoords> {
  const company = homeWeatherCompanyCoordinates();

  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve({
      lat: company.lat,
      lon: company.lon,
      source: "company",
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (coords: MarqueeWeatherCoords) => {
      if (settled) return;
      settled = true;
      resolve(coords);
    };

    const timer = window.setTimeout(
      () =>
        finish({
          lat: company.lat,
          lon: company.lon,
          source: "company",
        }),
      GEO_TIMEOUT_MS,
    );

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(timer);
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          finish({
            lat: company.lat,
            lon: company.lon,
            source: "company",
          });
          return;
        }
        finish({ lat, lon, source: "gps" });
      },
      () => {
        window.clearTimeout(timer);
        finish({
          lat: company.lat,
          lon: company.lon,
          source: "company",
        });
      },
      {
        enableHighAccuracy: false,
        timeout: 4000,
        maximumAge: 300_000,
      },
    );
  });
}

async function fetchMarqueeWeatherSafe(): Promise<{
  snapshot: Awaited<ReturnType<typeof fetchHomeWeatherOpenMeteo>> | null;
  locationSource: WeatherLocationSource;
}> {
  const coords = await resolveMarqueeWeatherCoords();
  try {
    const snapshot = await fetchHomeWeatherOpenMeteo(
      coords.lat,
      coords.lon,
      coords.source,
    );
    return { snapshot, locationSource: coords.source };
  } catch {
    if (coords.source === "gps") {
      try {
        const company = homeWeatherCompanyCoordinates();
        const snapshot = await fetchHomeWeatherOpenMeteo(
          company.lat,
          company.lon,
          "company",
        );
        return { snapshot, locationSource: "company" };
      } catch {
        return { snapshot: null, locationSource: "company" };
      }
    }
    return { snapshot: null, locationSource: "company" };
  }
}

/**
 * テロップ用天気（Open-Meteo + Geolocation）。
 * localStorage / sessionStorage には保存しない。
 */
export function useMarqueeWeather(): string {
  const [weatherLine, setWeatherLine] = useState(() =>
    formatHomeWeatherMarqueeLine(null, {
      loading: true,
      error: false,
      locationSource: "company",
    }),
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setWeatherLine(
        formatHomeWeatherMarqueeLine(null, {
          loading: true,
          error: false,
          locationSource: "company",
        }),
      );

      const { snapshot, locationSource } = await fetchMarqueeWeatherSafe();
      if (cancelled) return;

      setWeatherLine(
        formatHomeWeatherMarqueeLine(snapshot, {
          loading: false,
          error: !snapshot,
          locationSource,
        }),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return weatherLine;
}
