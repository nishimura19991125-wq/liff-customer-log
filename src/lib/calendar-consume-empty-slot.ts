import "server-only";

import type { AtPocketFetchAuth, AtPocketFieldRow, AtPocketRecordRow } from "@/lib/atpocket";
import {
  apiKeyForCalendarPocket1,
  apiKeyForCalendarWrite,
  fetchAllRecordsPages,
  fetchAppFields,
  deleteRecord,
} from "@/lib/atpocket";
import { optionalCalendarYmd } from "@/lib/calendar-optional-ymd";
import {
  constructionTitleFieldIsEmpty,
  pickRecordValueByFieldAliases,
  resolveConfiguredFieldToSchemaUniqueId,
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

function nextDayKey(dayKey: string): string | null {
  const m = dayKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** 同日空枠削除の結果。reason で未削除の理由を切り分ける */
export type ConsumeEmptySlotResult =
  | { deleted: true; deletedRecordId: string }
  | {
      deleted: false;
      reason:
        | "no_daykey"
        | "no_start_field"
        | "no_candidate"
        | "error"
        | "calendar_unconfigured";
      candidateCount?: number;
      status?: number;
      error?: string;
    };

function httpStatusFromError(e: unknown): number | undefined {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/failed:\s*(\d{3})/);
  return m ? Number(m[1]) : undefined;
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
  const next = nextDayKey(dayKey);
  const queries = [
    `${startId} = "${dayKey}"`,
    `${startId}="${dayKey}"`,
    // 日時格納（"YYYY-MM-DD HH:mm:ss"）で等価検索が外れるケースの範囲フォールバック
    ...(next ? [`${startId} >= "${dayKey}" and ${startId} < "${next}"`] : []),
  ];
  // 全クエリ結果を recordId でマージ（完全一致が新規ジョブだけを返しても範囲検索分を取りこぼさない）
  const merged = new Map<string, AtPocketRecordRow>();
  let anonymousIdx = 0;
  for (const query of queries) {
    try {
      const rows = await fetchAllRecordsPages(
        calAppId,
        fieldsCsv,
        readAuth,
        query,
        ctx,
        { maxPages: 10 },
      );
      for (const row of rows) {
        const key = recordIdString(row) ?? `__anon_${anonymousIdx++}`;
        if (!merged.has(key)) merged.set(key, row);
      }
    } catch (e) {
      console.warn("[calendar-consume-empty-slot] query failed", { query, error: String(e) });
    }
  }
  return [...merged.values()];
}

export async function consumeOneConstructionEmptySlotOnDate(opts: {
  calAppId: string;
  dayKey: string | null | undefined;
  excludeRecordId: string | null | undefined;
  customerFieldUniqueId: string;
  constructionFields: AtPocketFieldRow[];
  readAuth: AtPocketFetchAuth;
  writeAuth: AtPocketFetchAuth;
}): Promise<ConsumeEmptySlotResult> {
  const dayKey = opts.dayKey?.trim();
  const exclude = opts.excludeRecordId?.trim() || "";
  const customerId = opts.customerFieldUniqueId.trim();
  if (!dayKey || !customerId) {
    console.warn("[calendar-consume-empty-slot] skip: missing dayKey or customerField", {
      dayKey: dayKey || null,
      customerId: customerId || null,
    });
    return { deleted: false, reason: "no_daykey" };
  }

  const fids = resolveConstructionFieldIds(opts.constructionFields);
  const startId = fids.startDate?.trim();
  const titleFieldId = fids.title?.trim() || customerId;
  if (!startId) {
    console.warn("[calendar-consume-empty-slot] skip: startDate field unresolved");
    return { deleted: false, reason: "no_start_field" };
  }

  const fieldsCsv = uniqueFieldsCsv(startId, titleFieldId, customerId, fids.tNumber);

  const rows = await fetchConstructionRowsOnDay(
    opts.calAppId,
    startId,
    dayKey,
    fieldsCsv,
    opts.readAuth,
  );

  let emptyCandidateCount = 0;
  for (const row of rows) {
    const rid = recordIdString(row);
    if (!rid || rid === exclude) continue;
    if (!row.record || typeof row.record !== "object") continue;
    const recObj = row.record as Record<string, unknown>;
    if (!recordMatchesConsumeDayKey(recObj, startId, dayKey)) continue;
    if (!constructionTitleFieldIsEmpty(recObj, titleFieldId)) continue;

    emptyCandidateCount += 1;
    try {
      await deleteRecord(opts.calAppId, rid, opts.writeAuth);
      invalidateAllCalendarPayloadCache();
      console.info("[calendar-consume-empty-slot] deleted duplicate empty slot", {
        deletedRecordId: rid,
        dayKey,
      });
      return { deleted: true, deletedRecordId: rid };
    } catch (e) {
      const status = httpStatusFromError(e);
      console.warn("[calendar-consume-empty-slot] delete failed", {
        recordId: rid,
        dayKey,
        status: status ?? null,
        error: String(e),
      });
      return {
        deleted: false,
        reason: "error",
        status,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  console.info("[calendar-consume-empty-slot] no duplicate empty slot on day", {
    dayKey,
    excludeRecordId: exclude || null,
    fetchedRowCount: rows.length,
    emptyCandidateCount,
  });
  return { deleted: false, reason: "no_candidate", candidateCount: emptyCandidateCount };
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

/**
 * 工事カレンダーアプリ以外（お客様情報入力など）から、指定日の工事空枠を1件削除する。
 * CALENDAR_APP_ID とカレンダー用キーを使って単独で実行する。
 */
export async function consumeConstructionEmptySlotOnDateStandalone(
  rawDate: string | null | undefined,
): Promise<ConsumeEmptySlotResult> {
  const dayKey = optionalCalendarYmd(rawDate ?? undefined);
  if (!dayKey) return { deleted: false, reason: "no_daykey" };

  const calAppId = process.env.CALENDAR_APP_ID?.trim();
  if (!calAppId) return { deleted: false, reason: "calendar_unconfigured" };

  let readAuth: AtPocketFetchAuth;
  let writeAuth: AtPocketFetchAuth;
  try {
    readAuth = { apiKey: apiKeyForCalendarPocket1() };
    writeAuth = { apiKey: apiKeyForCalendarWrite() };
  } catch (e) {
    console.warn("[calendar-consume-empty-slot] calendar keys unavailable", String(e));
    return { deleted: false, reason: "calendar_unconfigured" };
  }

  try {
    const constructionFields = await fetchAppFields(calAppId, readAuth, {
      operation: "calendar:consume-empty-slot(external)",
      appEnv: "CALENDAR_APP_ID",
    });

    const customerField =
      process.env.CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID?.trim() ||
      process.env.CALENDAR_EMPTY_FILL_TITLE_FIELD_ID?.trim();
    const fids = resolveConstructionFieldIds(constructionFields);
    const resolvedCustomer = customerField
      ? resolveConfiguredFieldToSchemaUniqueId(customerField, constructionFields)
      : null;
    const customerFieldUniqueId = resolvedCustomer || fids.title;
    if (!customerFieldUniqueId) {
      return { deleted: false, reason: "no_start_field" };
    }

    return consumeOneConstructionEmptySlotOnDate({
      calAppId,
      dayKey,
      excludeRecordId: null,
      customerFieldUniqueId,
      constructionFields,
      readAuth,
      writeAuth,
    });
  } catch (e) {
    console.warn("[calendar-consume-empty-slot] standalone failed", String(e));
    return {
      deleted: false,
      reason: "error",
      status: httpStatusFromError(e),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
