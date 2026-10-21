import "server-only";

import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";

/**
 * ランキングから除外する担当者名の部分一致（ranking_pt_dashboard.js の hiddenSalesNames 相当 + 案件種別）
 *
 * ⚠ 「トラーチ倶楽部」は customer-info-club-construction-handler.ts の
 *   CLUB_CONSTRUCTION_HANDLER_NAME（工事対応者の自動入力）にも同じ文字列がある。
 *   用途が違う（こちらは部分一致の除外語）ので共有しない。片方を変えても、
 *   もう片方は変わらない。
 */
const EXCLUDED_STAFF_MARKERS = [
  "トラーチ倶楽部",
  "大和ハウス",
  "卸案件",
] as const;

function isDashOnlyName(name: string): boolean {
  return /^[-－—―ー・.\s]+$/.test(name);
}

/** 営業担当・AP担当者名がランキング対象外か */
export function isExcludedSalesDashboardRankingName(raw: string): boolean {
  const n = normApClStaffName(raw);
  if (!n) return true;
  if (isDashOnlyName(n)) return true;
  for (const marker of EXCLUDED_STAFF_MARKERS) {
    if (n.includes(marker)) return true;
  }
  return false;
}

/** アポ種別など案件ラベルがランキング対象外か */
export function isExcludedSalesDashboardCaseLabel(raw: string): boolean {
  const t = normApClStaffName(raw);
  if (!t) return false;
  for (const marker of EXCLUDED_STAFF_MARKERS) {
    if (t.includes(marker)) return true;
  }
  return false;
}
