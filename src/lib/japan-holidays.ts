/**
 * 日本の祝日（calendar_atpocket.js と同様の固定表・振替処理）。
 *
 * 元は calendar-kojo.ts の中にあった実装をそのまま移しただけ。
 * calendar-kojo.ts は server-only だが、キャンセル処理（タスクV）の確認画面が
 * クライアント側でも営業日を数える必要があるため、祝日の計算だけを
 * server-only でないモジュールへ切り出した。**祝日データは増やしていない。**
 *
 * 対応年は 2010〜2050（春分・秋分の表がこの範囲）。範囲外は
 * CALENDAR_EXTRA_HOLIDAYS 相当の追加分だけを返す。
 */

const SHUNBUN_DAY: Record<number, number> = {
  2010: 21, 2011: 20, 2012: 20, 2013: 20, 2014: 20, 2015: 20, 2016: 20,
  2017: 20, 2018: 20, 2019: 20, 2020: 20, 2021: 20, 2022: 21, 2023: 21,
  2024: 20, 2025: 20, 2026: 20, 2027: 20, 2028: 20, 2029: 20, 2030: 20,
  2031: 20, 2032: 20, 2033: 20, 2034: 20, 2035: 20, 2036: 20, 2037: 20,
  2038: 20, 2039: 20, 2040: 20, 2041: 20, 2042: 20, 2043: 20, 2044: 20,
  2045: 20, 2046: 20, 2047: 20, 2048: 20, 2049: 20, 2050: 20,
};

const SHUUBUN_DAY: Record<number, number> = {
  2010: 23, 2011: 23, 2012: 22, 2013: 23, 2014: 23, 2015: 23, 2016: 22,
  2017: 23, 2018: 23, 2019: 23, 2020: 22, 2021: 23, 2022: 23, 2023: 23,
  2024: 22, 2025: 23, 2026: 23, 2027: 23, 2028: 22, 2029: 23, 2030: 23,
  2031: 23, 2032: 22, 2033: 23, 2034: 23, 2035: 23, 2036: 22, 2037: 23,
  2038: 23, 2039: 23, 2040: 22, 2041: 23, 2042: 23, 2043: 23, 2044: 22,
  2045: 23, 2046: 23, 2047: 23, 2048: 22, 2049: 23, 2050: 23,
};

/** 祝日表の対応範囲 */
export const JAPAN_HOLIDAY_MIN_YEAR = 2010;
export const JAPAN_HOLIDAY_MAX_YEAR = 2050;

export function japanHolidayYmdKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

function getNthWeekdayInMonth(
  y: number,
  monthIndex: number,
  weekday: number,
  nth: number,
): number {
  const firstW = new Date(y, monthIndex, 1).getDay();
  const off = (weekday - firstW + 7) % 7;
  return 1 + off + (nth - 1) * 7;
}

function addKeysFromDate(set: Set<string>, y: number, m: number, d: number) {
  if (d < 1) return;
  const last = new Date(y, m + 1, 0).getDate();
  if (d > last) return;
  set.add(japanHolidayYmdKey(new Date(y, m, d, 0, 0, 0, 0)));
}

function applySubstituteHolidays(base: Set<string>): Set<string> {
  const h = new Set(base);
  const fixed = new Set(base);
  for (let i = 0; i < 2; i++) {
    const copy = Array.from(h);
    for (const key of copy) {
      const p = key.split("-");
      const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 0, 0, 0, 0);
      if (d.getDay() !== 0) continue;
      let t = addDays(d, 1);
      let guard = 0;
      while (fixed.has(japanHolidayYmdKey(t)) && guard < 10) {
        t = addDays(t, 1);
        guard += 1;
      }
      h.add(japanHolidayYmdKey(t));
    }
  }
  return h;
}

function applySandwichNationalHolidays(base: Set<string>, y: number): Set<string> {
  const h = new Set(base);
  for (let month = 1; month <= 12; month++) {
    const lastD = new Date(y, month, 0).getDate();
    for (let di = 1; di <= lastD; di++) {
      const cur = new Date(y, month - 1, di, 0, 0, 0, 0);
      if (cur.getDay() === 0 || cur.getDay() === 6) continue;
      const k = japanHolidayYmdKey(cur);
      if (h.has(k)) continue;
      if (
        h.has(japanHolidayYmdKey(addDays(cur, -1))) &&
        h.has(japanHolidayYmdKey(addDays(cur, 1)))
      ) {
        h.add(k);
      }
    }
  }
  return h;
}

export function buildJapanHolidayYmdSet(
  y: number,
  extraKeys: string[],
  includeSandwich: boolean,
): Set<string> {
  let h = new Set<string>();
  addKeysFromDate(h, y, 0, 1);
  addKeysFromDate(h, y, 0, getNthWeekdayInMonth(y, 0, 1, 2));
  addKeysFromDate(h, y, 1, 11);
  addKeysFromDate(h, y, 1, 23);
  const sp = SHUNBUN_DAY[y];
  if (sp) addKeysFromDate(h, y, 2, sp);
  addKeysFromDate(h, y, 3, 29);
  addKeysFromDate(h, y, 4, 3);
  addKeysFromDate(h, y, 4, 4);
  addKeysFromDate(h, y, 4, 5);
  addKeysFromDate(h, y, 6, getNthWeekdayInMonth(y, 6, 1, 3));
  addKeysFromDate(h, y, 7, 11);
  addKeysFromDate(h, y, 8, getNthWeekdayInMonth(y, 8, 1, 3));
  const au = SHUUBUN_DAY[y];
  if (au) addKeysFromDate(h, y, 8, au);
  addKeysFromDate(h, y, 9, getNthWeekdayInMonth(y, 9, 1, 2));
  addKeysFromDate(h, y, 10, 3);
  addKeysFromDate(h, y, 10, 23);
  for (const k of extraKeys) {
    if (k && String(k).slice(0, 4) === String(y)) h.add(String(k).trim());
  }
  h = applySubstituteHolidays(h);
  if (includeSandwich) h = applySandwichNationalHolidays(h, y);
  return h;
}

export function getJapanHolidayKeysForYear(
  y: number,
  extraKeys: string[],
  includeSandwich: boolean,
): string[] {
  if (y < JAPAN_HOLIDAY_MIN_YEAR || y > JAPAN_HOLIDAY_MAX_YEAR) {
    return [...extraKeys];
  }
  return Array.from(buildJapanHolidayYmdSet(y, extraKeys, includeSandwich));
}

/**
 * 期間にまたがる祝日キーの集合。年をまたぐ営業日計算で使う。
 * from / to は YYYY-MM-DD。
 */
export function japanHolidayKeysForRange(
  fromYear: number,
  toYear: number,
  extraKeys: string[] = [],
  includeSandwich = false,
): Set<string> {
  const out = new Set<string>();
  const start = Math.min(fromYear, toYear);
  const end = Math.max(fromYear, toYear);
  for (let y = start; y <= end; y++) {
    for (const k of getJapanHolidayKeysForYear(y, extraKeys, includeSandwich)) {
      out.add(k);
    }
  }
  return out;
}
