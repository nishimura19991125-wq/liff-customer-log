import "server-only";

import {
  coerceCustomerInfoDisplayString,
  readCustomerInfoFieldValue,
} from "@/lib/customer-info-record";

/** PT加算日・計上日など（YYYY-MM-DD / YYYY/MM/DD / 2026年5月15日 等） */
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
