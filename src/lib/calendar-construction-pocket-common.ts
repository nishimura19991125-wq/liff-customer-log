import "server-only";

import type { AtPocketFetchAuth, AtPocketRecordRow } from "@/lib/atpocket";
import {
  fetchRecordById,
  isPocketHttpRateLimitError,
  listAuthsForAppList,
} from "@/lib/atpocket";
import {
  pollConstructionTNumberByRecordId,
} from "@/lib/atpocket-record-id";

export {
  resolveConstructionRecordAfterCreate,
  resolveConstructionRecordIdAfterCreate,
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

function calendarRecordReadOptions(preferred?: AtPocketFetchAuth) {
  const listAuths = listAuthsForAppList("CALENDAR");
  const preferredKey = preferred?.apiKey?.trim();
  const authKeys =
    preferredKey && !listAuths.some((a) => a.apiKey === preferredKey)
      ? [{ apiKey: preferredKey }, ...listAuths]
      : listAuths.length > 0
        ? listAuths
        : preferred
          ? [preferred]
          : undefined;
  return {
    maxRetries: 1,
    ...(authKeys && authKeys.length >= 2 ? { authKeys } : {}),
  };
}

/** 空枠登録と同様: レコード GET（fields 指定失敗時は全フィールド。429 は再試行しない） */
export async function fetchConstructionRecordRow(
  calAppId: string,
  recordId: string,
  pocketAuth: AtPocketFetchAuth,
  fieldsCsv: string,
): Promise<AtPocketRecordRow | null> {
  const options = calendarRecordReadOptions(pocketAuth);
  try {
    const row = await fetchRecordById(
      calAppId,
      recordId,
      pocketAuth,
      fieldsCsv,
      options,
    );
    if (row?.record) return row;
  } catch (e) {
    if (isPocketHttpRateLimitError(e)) throw e;
    /* fall through: fields CSV が拒否された場合のみ全フィールド GET */
  }
  return fetchRecordById(calAppId, recordId, pocketAuth, undefined, options);
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

/**
 * 工事レコードから取込キー（Aki番号）を読む。
 *
 * 作成直後は採番が反映されるまで一瞬空のことがあるので、
 * T番号でやっていたのと同じ短いポーリングをこちらへ移した。
 * 工事アプリはもう T番号 を採番しないため、T番号 を待っても永久に空になる。
 */
export async function ensureConstructionImportKeyOnRecord(
  calAppId: string,
  recordId: string,
  importKeyFieldId: string,
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
    const key = readConstructionTNumberFromRecord(
      row.record as Record<string, unknown>,
      importKeyFieldId,
    );
    if (key) return key;
  }
  return pollConstructionTNumberByRecordId(
    calAppId,
    recordId,
    importKeyFieldId,
    pocketAuth,
    fieldsCsv,
  );
}

/**
 * 空枠 PUT / 新規登録後 PUT で共通のペイロード。
 *
 * ■ 取込キー（Aki番号）
 * @pocket は取込キーの列が本文に無いと 400 を返すので必ず載せる。
 * 作成時は空文字（@pocket が採番する）、更新時は既存値を載せる。
 *
 * ■ T番号
 * 工事アプリでは採番されない。お客様情報アプリが採番した値を
 * 転記してくるだけなので、**値があるときだけ**載せる。
 * 空文字で載せると、既に入っている T番号 を消してしまう。
 */
export function buildConstructionFillPatch(opts: {
  resolvedCustomer: string;
  resolvedHousing: string;
  /** 取込キー（Aki番号）の列。作成時は空文字を載せる */
  resolvedImportKey?: string;
  importKeyValue?: unknown;
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
  /** 施工予定日（YYYY-MM-DD・任意） */
  scheduledStartDate?: string;
  /** 施工会社（任意） */
  contractor?: string;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    [opts.resolvedCustomer]: opts.customerName,
    [opts.resolvedHousing]: opts.housingRaw,
  };
  const importKeyId = opts.resolvedImportKey?.trim();
  if (importKeyId) {
    // 値が無くても列は載せる。空なら @pocket が採番する
    patch[importKeyId] = opts.importKeyValue ?? "";
  }
  // T番号は転記されてくる値。空で上書きしない
  const tNumber = coerceTNumberDisplay(opts.tNumberValue);
  if (tNumber) patch[opts.resolvedTNumber] = tNumber;
  if (opts.resolvedHandlerField != null && opts.handlerValue != null) {
    patch[opts.resolvedHandlerField] = opts.handlerValue;
  }
  const startYmd = optionalCalendarYmd(opts.scheduledStartDate);
  const startId = opts.fids.startDate?.trim();
  if (startYmd && startId) patch[startId] = startYmd;
  const contractor = opts.contractor?.trim();
  const contractorId = opts.fids.contractor?.trim();
  if (contractor && contractorId) patch[contractorId] = contractor;
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
