import "server-only";

import {
  nfkcNormalize,
  pocketTableCellToPlainString,
} from "@/lib/staff-construction-availability";

function zeroPadLengthFromEnv(): number | null {
  const raw = process.env.STAFF_EMPLOYEE_ID_ZERO_PAD_LENGTH?.trim();
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 桁埋めのみ（プレーン文字列がすべて数字のとき） */
function applyDigitZeroPad(plain: string): string {
  const padLen = zeroPadLengthFromEnv();
  const t = nfkcNormalize(plain);
  if (padLen == null || !/^\d+$/.test(t)) return t;
  const n = Number(t);
  if (!Number.isFinite(n)) return t;
  const truncated = Math.trunc(n);
  if (truncated < 0) return t;
  return String(truncated).padStart(padLen, "0");
}

/**
 * スタッフ名簿の社員 ID セル値を、工事側などへ送る文字列に揃える。
 * API が数値 1 を返しても、画面が「000001」のときは STAFF_EMPLOYEE_ID_ZERO_PAD_LENGTH=6 などで桁埋めする。
 */
export function formatStaffEmployeeIdForApi(raw: unknown): string {
  return applyDigitZeroPad(pocketTableCellToPlainString(raw));
}

/** 検索キー・クライアント入力も同じ桁埋め規則で正規化して突き合わせる */
export function normalizeStaffEmployeeIdSearchInput(input: string): string {
  return applyDigitZeroPad(input);
}
