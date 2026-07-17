import "server-only";

import type {
  AtPocketFetchAuth,
  AtPocketFieldRow,
  AtPocketRecordRow,
} from "@/lib/atpocket";
import { fetchRecordById } from "@/lib/atpocket";
import type { UndatedConstructionCase } from "@/lib/calendar-api-types";
import { dayKeyFromConstructionRecord } from "@/lib/calendar-consume-empty-slot";
import { optionalCalendarYmd } from "@/lib/calendar-optional-ymd";
import {
  constructionTitleFieldIsEmpty,
  pickRecordValueByFieldAliases,
  resolveConstructionFieldIds,
  resolveConstructionTNumberFieldId,
  shortHousingStatusLabel,
  type ConstructionFieldIds,
} from "@/lib/calendar-kojo";
import { findCustomerInfoRecordIdByUniqueKeyCached } from "@/lib/customer-info-key-lookup-cache";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { readCustomerInfoFieldValue } from "@/lib/customer-info-record";

function coercePlainString(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw).trim();
  }
  if (Array.isArray(raw)) {
    return raw.map(coercePlainString).filter(Boolean).join(" ");
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

function recordIdFromRow(rec: AtPocketRecordRow): string | null {
  const raw = rec.recordId ?? rec.id;
  if (raw == null) return null;
  const s = String(raw).trim();
  return s || null;
}

function dayKeyFromFieldId(
  recObj: Record<string, unknown>,
  fieldId: string | undefined,
): string | null {
  const id = fieldId?.trim();
  if (!id) return null;
  const raw = pickRecordValueByFieldAliases(recObj, id);
  if (raw == null) return null;
  let s = coercePlainString(raw);
  if (!s) return null;
  s = s.replace(/\//g, "-").split("T")[0]?.split(" ")[0] ?? s;
  return optionalCalendarYmd(s);
}

/** 施工予定日・新築各日程のいずれかが入っていれば「日付あり」 */
export function constructionRecordHasAnyWorkDate(
  recObj: Record<string, unknown>,
  constructionFields: AtPocketFieldRow[],
  fids?: ConstructionFieldIds,
): boolean {
  if (dayKeyFromConstructionRecord(recObj, constructionFields)) return true;
  const ids = fids ?? resolveConstructionFieldIds(constructionFields);
  for (const fid of [
    ids.shigumi,
    ids.panelWork,
    ids.electricWork,
    ids.appSettingsDay,
  ]) {
    if (dayKeyFromFieldId(recObj, fid)) return true;
  }
  return false;
}

function housingStatusRawToShort(
  raw: string,
): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t === "新築案件" || t.includes("新築案件")) return shortHousingStatusLabel("新築案件");
  if (t === "既築案件" || t.includes("既築案件")) return shortHousingStatusLabel("既築案件");
  if (t === "トラーチ倶楽部案件" || t.includes("トラーチ")) {
    return shortHousingStatusLabel("トラーチ倶楽部案件");
  }
  if (t === "産業用案件" || t.includes("産業用")) {
    return shortHousingStatusLabel("産業用案件");
  }
  return shortHousingStatusLabel(t);
}

/**
 * お客様名あり・工事日未定の案件だけ抽出（メモリ内フィルタ）。
 */
export function buildUndatedConstructionCases(
  records: AtPocketRecordRow[],
  constructionFields: AtPocketFieldRow[],
): UndatedConstructionCase[] {
  const fids = resolveConstructionFieldIds(constructionFields);
  const titleId = fids.title?.trim();
  if (!titleId) return [];

  const tNumberId = resolveConstructionTNumberFieldId(constructionFields);
  const items: UndatedConstructionCase[] = [];

  for (const rec of records) {
    const recordId = recordIdFromRow(rec);
    if (!recordId) continue;
    if (!rec.record || typeof rec.record !== "object") continue;
    const recObj = rec.record as Record<string, unknown>;

    if (constructionTitleFieldIsEmpty(recObj, titleId)) continue;
    if (constructionRecordHasAnyWorkDate(recObj, constructionFields, fids)) {
      continue;
    }

    const customerName = coercePlainString(
      pickRecordValueByFieldAliases(recObj, titleId),
    );
    if (!customerName) continue;

    const housingRaw = fids.housingStatus
      ? coercePlainString(
          pickRecordValueByFieldAliases(recObj, fids.housingStatus),
        )
      : "";
    const contractorName = fids.contractor
      ? coercePlainString(
          pickRecordValueByFieldAliases(recObj, fids.contractor),
        )
      : "";
    const tNumber = tNumberId
      ? coercePlainString(pickRecordValueByFieldAliases(recObj, tNumberId))
      : "";

    items.push({
      recordId,
      customerName,
      housingShort: housingStatusRawToShort(housingRaw),
      contractorName,
      tNumber,
    });
  }

  items.sort((a, b) =>
    a.customerName.localeCompare(b.customerName, "ja"),
  );
  return items;
}

/**
 * お客様情報の AP/CL 担当がログイン者の担当名のいずれかと一致する案件だけ残す。
 * T番号が無い／お客様情報に見つからない案件は除外。
 */
export async function filterUndatedCasesByCallerApClStaff(
  items: UndatedConstructionCase[],
  opts: {
    customerAppId: string;
    customerKeyFieldId: string;
    apStaffFieldId: string | null;
    clStaffFieldId: string | null;
    callerApStaff: string | null;
    callerClStaff: string | null;
    customerAuth: AtPocketFetchAuth;
  },
): Promise<UndatedConstructionCase[]> {
  const wantNames = new Set(
    [opts.callerApStaff, opts.callerClStaff]
      .map((n) => normApClStaffName(n ?? ""))
      .filter(Boolean),
  );
  if (wantNames.size === 0) return [];

  const staffFieldsCsv = [opts.apStaffFieldId, opts.clStaffFieldId]
    .filter((id): id is string => Boolean(id?.trim()))
    .join(",");
  if (!staffFieldsCsv) return [];

  const out: UndatedConstructionCase[] = [];
  for (const item of items) {
    const tNumber = item.tNumber.trim();
    if (!tNumber) continue;

    const customerRecordId = await findCustomerInfoRecordIdByUniqueKeyCached(
      opts.customerKeyFieldId,
      tNumber,
    );
    if (!customerRecordId) continue;

    let row = await fetchRecordById(
      opts.customerAppId,
      customerRecordId,
      opts.customerAuth,
      staffFieldsCsv,
    );
    if (!row?.record) {
      row = await fetchRecordById(
        opts.customerAppId,
        customerRecordId,
        opts.customerAuth,
      );
    }
    if (!row?.record || typeof row.record !== "object") continue;
    const recObj = row.record as Record<string, unknown>;

    const apName = opts.apStaffFieldId
      ? normApClStaffName(
          readCustomerInfoFieldValue(recObj, opts.apStaffFieldId),
        )
      : "";
    const clName = opts.clStaffFieldId
      ? normApClStaffName(
          readCustomerInfoFieldValue(recObj, opts.clStaffFieldId),
        )
      : "";

    if (
      (apName && wantNames.has(apName)) ||
      (clName && wantNames.has(clName))
    ) {
      out.push(item);
    }
  }
  return out;
}

/** 割り当て時の権限確認：T番号先のお客様情報で AP/CL がログイン者と一致するか */
export async function callerOwnsCaseByTNumber(
  tNumber: string,
  opts: {
    customerAppId: string;
    customerKeyFieldId: string;
    apStaffFieldId: string | null;
    clStaffFieldId: string | null;
    callerApStaff: string | null;
    callerClStaff: string | null;
    customerAuth: AtPocketFetchAuth;
  },
): Promise<boolean> {
  const matched = await filterUndatedCasesByCallerApClStaff(
    [
      {
        recordId: "_",
        customerName: "_",
        housingShort: "",
        contractorName: "",
        tNumber,
      },
    ],
    opts,
  );
  return matched.length > 0;
}
