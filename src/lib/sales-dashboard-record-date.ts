import "server-only";

import {
  coerceCustomerInfoDisplayString,
  readCustomerInfoFieldValue,
} from "@/lib/customer-info-record";

/**
 * PT加算日・計上日・目標月など。次の順に見て、最初に読めたものを返す。
 *
 * 1. YYYY-MM-DD / YYYY/MM/DD（月日は1〜2桁可・先頭一致）
 * 2. YYYY年M月（「2026年9月8日」「2026年9月」など・月は1〜2桁可）
 * 3. 数字だけを抜き出して先頭4桁＝年・次の2桁＝月（YYYYMMDD 等）
 *
 * 2 が無いと「2026年9月8日」は 3 に落ち、数字列が 202698 になって
 * 5〜6桁目が「98」＝月として不正になり null を返す。10〜12月だけが
 * たまたま通り、1〜9月が黙って落ちていた（アポ件数部門が全件0になった原因）。
 * 分岐の置き場所と作りは meeting-schedule.ts の parseScheduledParts に合わせている。
 */
export function parseSalesDashboardRecordYm(
  raw: unknown,
): { year: number; month1: number } | null {
  const s = coerceCustomerInfoDisplayString(raw);
  if (!s) return null;

  const slashIso = s.replace(/\//g, "-");
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(slashIso);
  if (iso) {
    const year = Number(iso[1]);
    const month1 = Number(iso[2]);
    if (month1 >= 1 && month1 <= 12) return { year, month1 };
  }

  // 数字だけを見る下の経路より前に置く（「2026年9月8日」が 202698 になるため）
  const jp = /^(\d{4})\s*年\s*(\d{1,2})\s*月/.exec(s);
  if (jp) {
    const year = Number(jp[1]);
    const month1 = Number(jp[2]);
    if (month1 >= 1 && month1 <= 12) return { year, month1 };
  }

  const digits = s.replace(/[^\d]/g, "");
  if (digits.length < 6) return null;
  const year = Number(digits.slice(0, 4));
  const month1 = Number(digits.slice(4, 6));
  if (!Number.isFinite(year) || !Number.isFinite(month1)) return null;
  if (month1 < 1 || month1 > 12) return null;
  return { year, month1 };
}

export function parseSalesDashboardRecordYmFromField(
  recObj: Record<string, unknown>,
  fieldId: string,
): { year: number; month1: number } | null {
  return parseSalesDashboardRecordYm(
    readCustomerInfoFieldValue(recObj, fieldId),
  );
}

/** PT明細表示用。内部キー YYYY-MM-DD（取れなければ空文字） */
export function parseSalesDashboardRecordYmd(
  raw: unknown,
): string {
  const s = coerceCustomerInfoDisplayString(raw);
  if (!s) return "";

  const slashIso = s.replace(/\//g, "-");
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(slashIso);
  if (iso) {
    const year = Number(iso[1]);
    const month1 = Number(iso[2]);
    const day = Number(iso[3]);
    const dt = new Date(year, month1 - 1, day);
    if (
      dt.getFullYear() === year &&
      dt.getMonth() === month1 - 1 &&
      dt.getDate() === day
    ) {
      return `${String(year).padStart(4, "0")}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const digits = s.replace(/[^\d]/g, "");
  if (digits.length < 8) return "";
  const year = Number(digits.slice(0, 4));
  const month1 = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const dt = new Date(year, month1 - 1, day);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month1) ||
    !Number.isFinite(day) ||
    dt.getFullYear() !== year ||
    dt.getMonth() !== month1 - 1 ||
    dt.getDate() !== day
  ) {
    return "";
  }
  return `${String(year).padStart(4, "0")}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseSalesDashboardRecordYmdFromField(
  recObj: Record<string, unknown>,
  fieldId: string,
): string {
  return parseSalesDashboardRecordYmd(
    readCustomerInfoFieldValue(recObj, fieldId),
  );
}
