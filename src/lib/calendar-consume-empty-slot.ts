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
  if (!dayKey || !customerId) return { deleted: false };

  const fids = resolveConstructionFieldIds(opts.constructionFields);
  const startId = fids.startDate?.trim();
  if (!startId) return { deleted: false };

  const fieldsCsv = uniqueFieldsCsv(startId, customerId, fids.tNumber);
  const query = `${startId} = "${dayKey}"`;

  try {
    const rows = await fetchAllRecordsPages(
      opts.calAppId,
      fieldsCsv,
      opts.readAuth,
      query,
      { operation: "calendar:consume-empty-slot" },
      { maxPages: 10 },
    );

    for (const row of rows) {
      const rid = recordIdString(row);
      if (!rid || rid === exclude) continue;
      if (!row.record || typeof row.record !== "object") continue;
      const recObj = row.record as Record<string, unknown>;
      if (!constructionTitleFieldIsEmpty(recObj, customerId)) continue;

      await deleteRecord(opts.calAppId, rid, opts.writeAuth);
      invalidateAllCalendarPayloadCache();
      return { deleted: true, deletedRecordId: rid };
    }
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
