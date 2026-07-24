import "server-only";

import type { AtPocketFieldRow, AtPocketRecordRow } from "@/lib/atpocket";
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
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";

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

function housingStatusRawToShort(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t === "新築案件" || t.includes("新築案件")) {
    return shortHousingStatusLabel("新築案件");
  }
  if (t === "既築案件" || t.includes("既築案件")) {
    return shortHousingStatusLabel("既築案件");
  }
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
 * allowedTNumbers を渡すと T番号集合で絞り込む（任意）。
 * excludedTNumbers を渡すと該当 T番号を除外（キャンセル等）。
 */
export function buildUndatedConstructionCases(
  records: AtPocketRecordRow[],
  constructionFields: AtPocketFieldRow[],
  options?: {
    allowedTNumbers?: Set<string>;
    excludedTNumbers?: Set<string>;
  },
): UndatedConstructionCase[] {
  const fids = resolveConstructionFieldIds(constructionFields);
  const titleId = fids.title?.trim();
  if (!titleId) return [];

  const allowedTNumbers = options?.allowedTNumbers;
  if (allowedTNumbers && allowedTNumbers.size === 0) return [];
  const excludedTNumbers = options?.excludedTNumbers;

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

    const tNumber = tNumberId
      ? coercePlainString(pickRecordValueByFieldAliases(recObj, tNumberId))
      : "";
    const normT = normApClStaffName(tNumber);
    if (allowedTNumbers) {
      if (!normT || !allowedTNumbers.has(normT)) continue;
    }
    if (excludedTNumbers && normT && excludedTNumbers.has(normT)) {
      continue;
    }

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
