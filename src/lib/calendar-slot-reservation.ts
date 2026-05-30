import "server-only";

import type { AtPocketFetchAuth } from "@/lib/atpocket";
import { fetchRecordById } from "@/lib/atpocket";
import { CALENDAR_SLOT_CONFLICT_MESSAGE } from "@/lib/calendar-slot-conflict";
import { constructionTitleFieldIsEmpty } from "@/lib/calendar-kojo";

export type ConstructionSlotFreshState =
  | { ok: true; isEmpty: true }
  | { ok: true; isEmpty: false; occupied: true }
  | { ok: false; reason: "not_found" };

/**
 * @pocket から単票を直接取得（サーバー側カレンダーキャッシュは経由しない）。
 * 書き込み直前の楽観的ロック用。
 */
export async function readFreshConstructionEmptySlotState(
  calAppId: string,
  recordId: string,
  readAuth: AtPocketFetchAuth,
  customerFieldUniqueId: string,
): Promise<ConstructionSlotFreshState> {
  const row = await fetchRecordById(
    calAppId,
    recordId,
    readAuth,
    customerFieldUniqueId,
  );
  if (!row?.record || typeof row.record !== "object") {
    return { ok: false, reason: "not_found" };
  }
  const isEmpty = constructionTitleFieldIsEmpty(
    row.record as Record<string, unknown>,
    customerFieldUniqueId,
  );
  if (isEmpty) return { ok: true, isEmpty: true };
  return { ok: true, isEmpty: false, occupied: true };
}

export function calendarSlotConflictResponse() {
  return {
    status: 409 as const,
    body: {
      slotConflict: true as const,
      error: CALENDAR_SLOT_CONFLICT_MESSAGE,
    },
  };
}
