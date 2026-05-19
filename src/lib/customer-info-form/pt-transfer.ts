import type { CustomerInfoFormValues } from "@/lib/customer-info-form/types";

/** @pocket 転記先（編集フォームには出さない） */
export const CUSTOMER_INFO_PT_TRANSFER_FIELDS = [
  { key: "clpt", caption: "CLPT" },
  { key: "appt", caption: "APPT" },
] as const;

/** 数字のみ抽出（カンマ・全角数字は正規化） */
export function parsePtDigitsOnly(raw: string): string {
  const normalized = raw.normalize("NFKC").trim();
  if (!normalized) return "";
  const digits = normalized.replace(/[^\d]/g, "");
  return digits;
}

/** 画面表示用（3桁カンマ。空は空文字） */
export function formatPtWithCommas(digits: string): string {
  const d = parsePtDigitsOnly(digits);
  if (!d) return "";
  const n = Number(d);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("ja-JP");
}

/** @pocket 転記用（カンマなしの整数文字列。未入力は null） */
export function ptValueForPocketTransfer(digits: string): string | null {
  const d = parsePtDigitsOnly(digits);
  if (!d) return null;
  const n = Number(d);
  if (!Number.isFinite(n) || n < 0) return null;
  return String(Math.floor(n));
}

export function normApClStaffName(raw: string | undefined): string {
  return (raw ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function isSameApClStaff(values: CustomerInfoFormValues): boolean {
  const ap = normApClStaffName(values.apStaff);
  const cl = normApClStaffName(values.clStaff);
  return Boolean(ap && cl && ap === cl);
}

export type PtTransferResult = {
  clpt: string;
  appt: string;
};

/**
 * AP担当者とCL担当者が同一なら CLPT に PT 全体、APPT は 0。
 * 異なる場合は PT÷2（小数点以下切り捨て）を APPT・CLPT にそれぞれ転記。
 */
export function computePtTransfer(values: CustomerInfoFormValues): PtTransferResult {
  const dash = "-";
  const ptStr = ptValueForPocketTransfer(values.pt ?? "");
  if (!ptStr) {
    return { clpt: dash, appt: dash };
  }

  const ap = normApClStaffName(values.apStaff);
  const cl = normApClStaffName(values.clStaff);
  const ptNum = Number(ptStr);

  if (ap && cl && ap === cl) {
    return { clpt: ptStr, appt: "0" };
  }

  const half = Math.floor(ptNum / 2);
  return { clpt: String(half), appt: String(half) };
}

/** PT 列本体もカンマなしで送る */
export function ptFieldValueForPocket(digits: string): string {
  return ptValueForPocketTransfer(digits) ?? "";
}
