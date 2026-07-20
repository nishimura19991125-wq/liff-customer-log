import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import { optionalCalendarYmd } from "@/lib/calendar-optional-ymd";
import {
  pickRecordValueByFieldAliases,
  resolveConstructionFieldIds,
} from "@/lib/calendar-kojo";

function dayKeyFromRecordField(
  recObj: Record<string, unknown>,
  fieldId: string,
): string | null {
  const raw = pickRecordValueByFieldAliases(recObj, fieldId);
  if (raw == null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/\//g, "-").split("T")[0]?.split(" ")[0] ?? s;
  return optionalCalendarYmd(s);
}

export function dayKeyFromConstructionRecord(
  recObj: Record<string, unknown>,
  constructionFields: AtPocketFieldRow[],
): string | null {
  const fids = resolveConstructionFieldIds(constructionFields);
  const startId = fids.startDate?.trim();
  if (!startId) return null;
  return dayKeyFromRecordField(recObj, startId);
}

/** 施工予定日。施工予定日列 → フォールバック日付の順で解決 */
export function resolveConsumeEmptySlotDayKey(
  recObj: Record<string, unknown>,
  constructionFields: AtPocketFieldRow[],
  fallbackDates?: Array<string | null | undefined>,
): string | null {
  const fromRecord = dayKeyFromConstructionRecord(recObj, constructionFields);
  if (fromRecord) return fromRecord;
  for (const raw of fallbackDates ?? []) {
    const ymd = optionalCalendarYmd(raw ?? undefined);
    if (ymd) return ymd;
  }
  return null;
}
