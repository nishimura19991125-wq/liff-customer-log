/** Open-Meteo（無料・登録不要）で天気を取得 */

export type HomeWeatherSnapshot = {
  label: string;
  precipitationPercent: number;
  temperatureC: number;
  rainAdvice: string | null;
};

const DEFAULT_LAT = 35.6762;
const DEFAULT_LON = 139.6503;

export function homeWeatherDefaultCoordinates(): { lat: number; lon: number } {
  const latRaw = process.env.NEXT_PUBLIC_HOME_WEATHER_LAT?.trim();
  const lonRaw = process.env.NEXT_PUBLIC_HOME_WEATHER_LON?.trim();
  const lat = latRaw ? Number(latRaw) : DEFAULT_LAT;
  const lon = lonRaw ? Number(lonRaw) : DEFAULT_LON;
  return {
    lat: Number.isFinite(lat) ? lat : DEFAULT_LAT,
    lon: Number.isFinite(lon) ? lon : DEFAULT_LON,
  };
}

function weatherEmojiAndLabel(code: number): { emoji: string; label: string } {
  if (code === 0) return { emoji: "☀️", label: "晴れ" };
  if (code === 1) return { emoji: "🌤️", label: "おおむね晴れ" };
  if (code === 2) return { emoji: "⛅", label: "くもり時々晴れ" };
  if (code === 3) return { emoji: "☁️", label: "くもり" };
  if (code === 45 || code === 48) return { emoji: "🌫️", label: "霧" };
  if (code >= 51 && code <= 57) return { emoji: "🌦️", label: "霧雨" };
  if (code >= 61 && code <= 67) return { emoji: "🌧️", label: "雨" };
  if (code >= 71 && code <= 77) return { emoji: "❄️", label: "雪" };
  if (code >= 80 && code <= 82) return { emoji: "🌦️", label: "にわか雨" };
  if (code >= 95) return { emoji: "⛈️", label: "雷雨" };
  return { emoji: "🌡️", label: "天気不明" };
}

function maxAfternoonPrecip(hourly: {
  time?: string[];
  precipitation_probability?: number[];
}): number {
  const times = hourly.time ?? [];
  const probs = hourly.precipitation_probability ?? [];
  let max = 0;
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (!t || !t.includes("T")) continue;
    const hour = Number(t.split("T")[1]?.slice(0, 2));
    if (!Number.isFinite(hour) || hour < 12 || hour > 18) continue;
    const p = probs[i];
    if (typeof p === "number" && p > max) max = p;
  }
  return max;
}

export async function fetchHomeWeatherOpenMeteo(
  lat: number,
  lon: number,
): Promise<HomeWeatherSnapshot> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,weather_code",
    hourly: "precipitation_probability",
    forecast_days: "1",
    timezone: "Asia/Tokyo",
  });

  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?${params}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error(`天気の取得に失敗しました（${res.status}）`);
  }

  const json = (await res.json()) as {
    current?: {
      temperature_2m?: number;
      weather_code?: number;
    };
    hourly?: {
      time?: string[];
      precipitation_probability?: number[];
    };
  };

  const temp = Math.round(json.current?.temperature_2m ?? 0);
  const code = json.current?.weather_code ?? 3;
  const { emoji, label } = weatherEmojiAndLabel(code);

  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
  }).format(now);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Tokyo",
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
  const hourKey = `${today}T${String(hour).padStart(2, "0")}`;

  const times = json.hourly?.time ?? [];
  const probs = json.hourly?.precipitation_probability ?? [];
  let precipNow = 0;
  const idx = times.findIndex((t) => t.startsWith(hourKey));
  if (idx >= 0 && typeof probs[idx] === "number") {
    precipNow = probs[idx]!;
  } else if (probs.length > 0) {
    precipNow = probs[0] ?? 0;
  }

  const afternoonMax = maxAfternoonPrecip(json.hourly ?? {});
  const precipDisplay = Math.max(precipNow, afternoonMax);

  let rainAdvice: string | null = null;
  if (precipDisplay >= 50 || (code >= 61 && code <= 67) || code >= 80) {
    rainAdvice = "☔ 午後から雨予報です。置き傘を忘れずに！";
  }

  return {
    label: `${emoji} ${label} / ${temp}℃ / 降水確率 ${Math.round(precipDisplay)}%`,
    precipitationPercent: precipDisplay,
    temperatureC: temp,
    rainAdvice,
  };
}

export function formatHomeWeatherMarqueeLine(
  weather: HomeWeatherSnapshot | null,
  loading: boolean,
  error: boolean,
): string {
  if (loading) return "🌤️ リアルタイム天気予報　取得中…　｜　";
  if (error || !weather) {
    return "🌤️ リアルタイム天気予報　しばらくして再表示します　｜　";
  }
  if (weather.rainAdvice) {
    return `${weather.rainAdvice}　｜　`;
  }
  return `${weather.label}　｜　`;
}
