import "server-only";

import {
  boundStaffFromRosterRows,
  fetchStaffRosterRowsCached,
} from "@/lib/staff-roster-cache";

/** LINE 紐付け済みスタッフの担当者名（名簿の「担当者名」列） */
export async function resolveBoundStaffNameForLineUser(
  lineUserId: string,
): Promise<string | null> {
  const rows = await fetchStaffRosterRowsCached();
  const bound = boundStaffFromRosterRows(rows, lineUserId);
  return bound?.name ?? null;
}
