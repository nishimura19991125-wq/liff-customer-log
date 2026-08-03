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

export function jstWallParts(now: Date = new Date()): {
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

/** JST の YYYY-MM-DD */
export function jstYmd(now = new Date()): string {
  const j = jstWallParts(now);
  return `${j.y}-${String(j.m).padStart(2, "0")}-${String(j.d).padStart(2, "0")}`;
}

/**
 * @pocket 向け日時文字列（JST・スラッシュ区切り）。
 * fieldType: Time → HH:mm / Date → YYYY/MM/DD / それ以外 → YYYY/MM/DD HH:mm:ss
 */
export function formatJstForPocketField(
  fieldType: string | null | undefined,
  now = new Date(),
): string {
  const j = jstWallParts(now);
  const y = String(j.y);
  const m = String(j.m).padStart(2, "0");
  const d = String(j.d).padStart(2, "0");
  const hh = String(j.h).padStart(2, "0");
  const mm = String(j.min).padStart(2, "0");
  const ss = String(j.s).padStart(2, "0");
  const ft = (fieldType ?? "").trim();
  if (ft === "Time") return `${hh}:${mm}`;
  if (ft === "Date") return `${y}/${m}/${d}`;
  return `${y}/${m}/${d} ${hh}:${mm}:${ss}`;
}

/**
 * 既存の日時文字列を @pocket 書き込み用（JST・可能な範囲で）に正規化する。
 * ISO（Z/オフセット付き）は JST に変換。それ以外は表記を整える。
 */
export function normalizeDateTimeForPocketField(
  raw: string,
  fieldType: string | null | undefined,
): string {
  const s = raw.trim();
  if (!s) return s;
  const ft = (fieldType ?? "").trim();

  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return formatJstForPocketField(ft, d);
    }
  }

  if (ft === "Time") {
    const m = /(\d{1,2}):(\d{2})/.exec(s.replace("T", " "));
    if (!m) return s;
    return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
  }

  const normalized = s.replace("T", " ").replace(/-/g, "/");
  const m =
    /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(
      normalized,
    );
  if (!m) return s;
  const y = m[1]!;
  const mo = String(Number(m[2])).padStart(2, "0");
  const d = String(Number(m[3])).padStart(2, "0");
  if (ft === "Date" || m[4] == null) return `${y}/${mo}/${d}`;
  const hh = String(Number(m[4])).padStart(2, "0");
  const mm = String(Number(m[5])).padStart(2, "0");
  const ss = m[6] != null ? String(Number(m[6])).padStart(2, "0") : "00";
  return `${y}/${mo}/${d} ${hh}:${mm}:${ss}`;
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
