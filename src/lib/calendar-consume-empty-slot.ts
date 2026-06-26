import "server-only";

import type { AtPocketFetchAuth, AtPocketFieldRow, AtPocketRecordRow } from "@/lib/atpocket";
import {
  fetchAllRecordsPages,
  deleteRecord,
} from "@/lib/atpocket";
import { optionalCalendarYmd } from "@/lib/calendar-optional-ymd";
import {
  constructionTitleFieldIsEmpty,
  pickRecordValueByFieldAliases,
  resolveConstructionFieldIds,
} from "@/lib/calendar-kojo";
import { uniqueFieldsCsv } from "@/lib/calendar-construction-pocket-common";
import { invalidateAllCalendarPayloadCache } from "@/lib/calendar-response-cache";

function recordIdString(rec: AtPocketRecordRow): string | null {
  const raw = rec.recordId ?? rec.id;
  if (raw == null) return null;
  const s = String(raw).trim();
  return s || null;
}

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

/**
 * お客様情報入力（空枠更新・新規登録）で案件が1件増えたとき、
 * 同じ施工予定日に残っている別の工事空枠があれば1件だけ削除する。
 */
function recordMatchesConsumeDayKey(
  recObj: Record<string, unknown>,
  startId: string,
  dayKey: string,
): boolean {
  return dayKeyFromRecordField(recObj, startId) === dayKey;
}

async function fetchConstructionRowsOnDay(
  calAppId: string,
  startId: string,
  dayKey: string,
  fieldsCsv: string,
  readAuth: AtPocketFetchAuth,
): Promise<AtPocketRecordRow[]> {
  const ctx = { operation: "calendar:consume-empty-slot" };
  const queries = [
    `${startId} = "${dayKey}"`,
    `${startId}="${dayKey}"`,
  ];
  for (const query of queries) {
    const rows = await fetchAllRecordsPages(
      calAppId,
      fieldsCsv,
      readAuth,
      query,
      ctx,
      { maxPages: 10 },
    );
    if (rows.length > 0) return rows;
  }
  return [];
}

export async function consumeOneConstructionEmptySlotOnDate(opts: {
  calAppId: string;
  dayKey: string | null | undefined;
  excludeRecordId: string | null | undefined;
  customerFieldUniqueId: string;
  constructionFields: AtPocketFieldRow[];
  readAuth: AtPocketFetchAuth;
  writeAuth: AtPocketFetchAuth;
}): Promise<{ deleted: boolean; deletedRecordId?: string }> {
  const dayKey = opts.dayKey?.trim();
  const exclude = opts.excludeRecordId?.trim() || "";
  const customerId = opts.customerFieldUniqueId.trim();
  if (!dayKey || !customerId) {
    console.warn("[calendar-consume-empty-slot] skip: missing dayKey or customerField", {
      dayKey: dayKey || null,
      customerId: customerId || null,
    });
    return { deleted: false };
  }

  const fids = resolveConstructionFieldIds(opts.constructionFields);
  const startId = fids.startDate?.trim();
  const titleFieldId = fids.title?.trim() || customerId;
  if (!startId) {
    console.warn("[calendar-consume-empty-slot] skip: startDate field unresolved");
    return { deleted: false };
  }

  const fieldsCsv = uniqueFieldsCsv(startId, titleFieldId, customerId, fids.tNumber);

  try {
    const rows = await fetchConstructionRowsOnDay(
      opts.calAppId,
      startId,
      dayKey,
      fieldsCsv,
      opts.readAuth,
    );

    for (const row of rows) {
      const rid = recordIdString(row);
      if (!rid || rid === exclude) continue;
      if (!row.record || typeof row.record !== "object") continue;
      const recObj = row.record as Record<string, unknown>;
      if (!recordMatchesConsumeDayKey(recObj, startId, dayKey)) continue;
      if (!constructionTitleFieldIsEmpty(recObj, titleFieldId)) continue;

      await deleteRecord(opts.calAppId, rid, opts.writeAuth);
      invalidateAllCalendarPayloadCache();
      console.info("[calendar-consume-empty-slot] deleted duplicate empty slot", {
        deletedRecordId: rid,
        dayKey,
      });
      return { deleted: true, deletedRecordId: rid };
    }

    console.info("[calendar-consume-empty-slot] no duplicate empty slot on day", {
      dayKey,
      excludeRecordId: exclude || null,
      candidateCount: rows.length,
    });
  } catch (e) {
    console.warn("[calendar-consume-empty-slot]", e);
  }

  return { deleted: false };
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

/** 空枠削除用の施工予定日。施工予定日列 → 新築4日程の順で解決 */
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
