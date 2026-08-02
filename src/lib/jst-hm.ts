/** JST の HH:mm 比較・待機用（Asia/Tokyo・DST なし前提） */

export function jstHmNow(now = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

export function isAtOrAfterJstHm(targetHm: string, now = new Date()): boolean {
  return jstHmNow(now) >= targetHm;
}

function jstWallParts(now: Date): {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  s: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    h: get("hour"),
    min: get("minute"),
    s: get("second"),
  };
}

function parseHm(
  targetHm: string,
): { th: number; tm: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(targetHm.trim());
  if (!match) return null;
  const th = Number(match[1]);
  const tm = Number(match[2]);
  if (
    !Number.isFinite(th) ||
    !Number.isFinite(tm) ||
    th < 0 ||
    th > 23 ||
    tm < 0 ||
    tm > 59
  ) {
    return null;
  }
  return { th, tm };
}

/**
 * 当日の targetHm（HH:mm）までの残り ms。
 * すでに過ぎている場合は null。
 */
export function msUntilJstHmToday(
  targetHm: string,
  now = new Date(),
): number | null {
  const hm = parseHm(targetHm);
  if (!hm) return null;

  const j = jstWallParts(now);
  const nowAsUtc = Date.UTC(j.y, j.m - 1, j.d, j.h, j.min, j.s);
  const targetAsUtc = Date.UTC(j.y, j.m - 1, j.d, hm.th, hm.tm, 0);
  const diff = targetAsUtc - nowAsUtc;
  if (diff <= 0) return null;
  return diff;
}

/**
 * 指定 JST 日付（YYYY-MM-DD）の targetHm までの残り ms。
 * すでに過ぎている場合は null。
 */
export function msUntilJstDateHm(
  ymd: string,
  targetHm: string,
  now = new Date(),
): number | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  const hm = parseHm(targetHm);
  if (!dateMatch || !hm) return null;
  const y = Number(dateMatch[1]);
  const m = Number(dateMatch[2]);
  const d = Number(dateMatch[3]);

  const j = jstWallParts(now);
  const nowAsUtc = Date.UTC(j.y, j.m - 1, j.d, j.h, j.min, j.s);
  const targetAsUtc = Date.UTC(y, m - 1, d, hm.th, hm.tm, 0);
  const diff = targetAsUtc - nowAsUtc;
  if (diff <= 0) return null;
  return diff;
}
