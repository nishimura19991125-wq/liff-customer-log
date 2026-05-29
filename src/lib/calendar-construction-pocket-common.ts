import "server-only";

import type { AtPocketCreateRecordResult, AtPocketFetchAuth, AtPocketRecordRow } from "@/lib/atpocket";
import { fetchRecordById } from "@/lib/atpocket";
import {
  atPocketRecordIdFromCreateResponse,
  atPocketRecordIdFromCreateResult,
  findConstructionRecordByNewEntryOnce,
  pollConstructionTNumberByRecordId,
  type ConstructionLookupOpts,
  type ConstructionRecordMatch,
} from "@/lib/atpocket-record-id";
import { pickRecordValueByFieldAliases } from "@/lib/calendar-kojo";
import {
  EMPTY_FILL_HOUSING_STATUS_NEW_BUILD,
} from "@/lib/calendar-empty-fill-options";
import { optionalCalendarYmd } from "@/lib/calendar-optional-ymd";
import type { ConstructionFieldIds } from "@/lib/calendar-kojo";

/** GET/PUT に載せるフィールドは必要なもののみ */
export function uniqueFieldsCsv(...uids: (string | undefined)[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const u of uids) {
    const t = u?.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      parts.push(t);
    }
  }
  return parts.join(",");
}

function coerceTNumberDisplay(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw).trim();
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const k of ["value", "displayValue", "label", "name", "text"]) {
      const v = o[k];
      if (v != null && (typeof v === "string" || typeof v === "number")) {
        return String(v).trim();
      }
    }
  }
  return String(raw).trim();
}

/** 空枠登録と同様: レコード GET（fields 指定失敗時は全フィールド） */
export async function fetchConstructionRecordRow(
  calAppId: string,
  recordId: string,
  pocketAuth: AtPocketFetchAuth,
  fieldsCsv: string,
): Promise<AtPocketRecordRow | null> {
  try {
    const row = await fetchRecordById(
      calAppId,
      recordId,
      pocketAuth,
      fieldsCsv,
    );
    if (row?.record) return row;
  } catch {
    /* fall through */
  }
  return fetchRecordById(calAppId, recordId, pocketAuth);
}

export function readConstructionTNumberFromRecord(
  recObj: Record<string, unknown>,
  tNumberFieldId: string,
): string | null {
  const raw = pickRecordValueByFieldAliases(recObj, tNumberFieldId);
  if (raw === undefined || raw === null) return null;
  const t = coerceTNumberDisplay(raw);
  return t || null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function recordIdFromCreateRawBody(
  createResult: AtPocketCreateRecordResult,
): string | null {
  const raw = createResult.rawBody?.trim();
  if (!raw) return null;
  try {
    const id = atPocketRecordIdFromCreateResponse(
      JSON.parse(raw) as Record<string, unknown>,
      createResult.location,
    );
    if (id) return id;
  } catch {
    /* 非 JSON 応答 */
  }
  const m = raw.match(/\/records\/(\d+)(?:\/|$|[?#])/i);
  return m?.[1]?.trim() || null;
}

/**
 * 新規 POST 直後: 応答・一覧から recordId / T番号 を解決（リトライ付き）。
 * recordId が無くても T番号が取れればお客様情報連携可能。
 */
export async function resolveConstructionRecordAfterCreate(
  calAppId: string,
  createResult: AtPocketCreateRecordResult,
  lookup: ConstructionLookupOpts,
  auth: AtPocketFetchAuth,
): Promise<ConstructionRecordMatch> {
  let recordId =
    atPocketRecordIdFromCreateResult(createResult) ??
    recordIdFromCreateRawBody(createResult);
  let uniqueKey: string | null = null;

  const delays = [0, 1000, 2500] as const;
  for (const delay of delays) {
    if (delay > 0) await sleep(delay);
    if (recordId && uniqueKey) break;
    const listed = await findConstructionRecordByNewEntryOnce(
      calAppId,
      lookup,
      auth,
    );
    recordId = recordId ?? listed.recordId;
    uniqueKey = uniqueKey ?? listed.uniqueKey;
    if (recordId || uniqueKey) break;
  }

  return { recordId, uniqueKey };
}

/** @deprecated resolveConstructionRecordAfterCreate を使用 */
export async function resolveRecordIdAfterConstructionCreate(
  calAppId: string,
  createResult: AtPocketCreateRecordResult,
  lookup: ConstructionLookupOpts,
  auth: AtPocketFetchAuth,
): Promise<string | null> {
  const m = await resolveConstructionRecordAfterCreate(
    calAppId,
    createResult,
    lookup,
    auth,
  );
  return m.recordId;
}

/** 自動採番直後: GET で T番号が付くまで短く待つ（空枠は既存 T を読むだけ） */
export async function ensureConstructionTNumberOnRecord(
  calAppId: string,
  recordId: string,
  tNumberFieldId: string,
  pocketAuth: AtPocketFetchAuth,
  fieldsCsv: string,
): Promise<string | null> {
  const row = await fetchConstructionRecordRow(
    calAppId,
    recordId,
    pocketAuth,
    fieldsCsv,
  );
  if (row?.record && typeof row.record === "object") {
    const t = readConstructionTNumberFromRecord(
      row.record as Record<string, unknown>,
      tNumberFieldId,
    );
    if (t) return t;
  }
  return pollConstructionTNumberByRecordId(
    calAppId,
    recordId,
    tNumberFieldId,
    pocketAuth,
    fieldsCsv,
  );
}

/** 空枠 PUT / 新規登録後 PUT で共通のペイロード */
export function buildConstructionFillPatch(opts: {
  resolvedCustomer: string;
  resolvedHousing: string;
  resolvedTNumber: string;
  tNumberValue: unknown;
  customerName: string;
  housingRaw: string;
  resolvedHandlerField?: string;
  handlerValue?: string;
  fids: ConstructionFieldIds;
  shigumiDate?: string;
  panelWorkDate?: string;
  electricWorkDate?: string;
  appSettingsDayDate?: string;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    [opts.resolvedTNumber]: opts.tNumberValue,
    [opts.resolvedCustomer]: opts.customerName,
    [opts.resolvedHousing]: opts.housingRaw,
  };
  if (opts.resolvedHandlerField != null && opts.handlerValue != null) {
    patch[opts.resolvedHandlerField] = opts.handlerValue;
  }
  if (opts.housingRaw === EMPTY_FILL_HOUSING_STATUS_NEW_BUILD) {
    const quad: Array<[fieldId: string | undefined, raw: string | undefined]> =
      [
        [opts.fids.shigumi, opts.shigumiDate],
        [opts.fids.panelWork, opts.panelWorkDate],
        [opts.fids.electricWork, opts.electricWorkDate],
        [opts.fids.appSettingsDay, opts.appSettingsDayDate],
      ];
    for (const [fid, raw] of quad) {
      const ymd = optionalCalendarYmd(raw);
      const id = fid?.trim();
      if (ymd && id) patch[id] = ymd;
    }
  }
  return patch;
}
