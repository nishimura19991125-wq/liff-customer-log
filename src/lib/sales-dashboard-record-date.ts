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
