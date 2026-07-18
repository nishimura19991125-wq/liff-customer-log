import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import type { SalesDashboardPayload } from "@/lib/sales-dashboard-data";

/** 全社共通キャッシュにログイン担当者の isSelf を付与 */
export function personalizeSalesDashboardPayload(
  core: SalesDashboardPayload,
  boundStaffName: string,
): SalesDashboardPayload {
  const bound = normApClStaffName(boundStaffName);
  return {
    ...core,
    staffName: boundStaffName,
    ptBreakdownByStaff: core.ptBreakdownByStaff ?? {},
    ranking: core.ranking.map((r) => ({
      ...r,
      isSelf: normApClStaffName(r.staffName) === bound,
    })),
    apoRanking: core.apoRanking.map((r) => ({
      ...r,
      isSelf: normApClStaffName(r.staffName) === bound,
    })),
    tenkaRanking: core.tenkaRanking.map((r) => ({
      ...r,
      isSelf: normApClStaffName(r.staffName) === bound,
    })),
  };
}
