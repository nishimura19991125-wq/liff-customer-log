import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import type {
  SalesDashboardPayload,
  SalesDashboardProgressPayload,
} from "@/lib/sales-dashboard-data";

/** 進捗の内訳にも本人の目印を付ける。支社の合計・人数は変えない */
function personalizeProgress(
  progress: SalesDashboardProgressPayload,
  bound: string,
): SalesDashboardProgressPayload {
  return {
    ...progress,
    branches: progress.branches.map((b) => ({
      ...b,
      members: b.members.map((m) => ({
        ...m,
        isSelf: normApClStaffName(m.staffName) === bound,
      })),
    })),
  };
}

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
    progress: personalizeProgress(core.progress, bound),
    annualProgress: personalizeProgress(core.annualProgress, bound),
  };
}
