import type {
  AtPocketFieldOption,
  AtPocketFieldRow,
  AtPocketRecordRow,
} from "@/lib/atpocket";
import { nfkcNormalize } from "@/lib/staff-construction-availability";

function optionNormKeys(opt: AtPocketFieldOption): string[] {
  return [...new Set([opt.label, opt.value].map(nfkcNormalize).filter(Boolean))];
}

/** フィールド定義から選択肢を取り出す */
export function extractConstructionHandlerFieldOptions(
  fields: AtPocketFieldRow[],
  handlerFieldId: string,
): AtPocketFieldOption[] {
  const id = handlerFieldId.trim();
  if (!id) return [];
  const field = fields.find((f) => f.uniqueId?.trim() === id);
  return field?.options?.length ? [...field.options] : [];
}

function readCell(
  rec: Record<string, unknown>,
  fieldId: string,
): unknown {
  if (Object.prototype.hasOwnProperty.call(rec, fieldId)) {
    return rec[fieldId];
  }
  const want = fieldId.trim();
  for (const [k, v] of Object.entries(rec)) {
    if (k.trim() === want) return v;
  }
  return undefined;
}

/** 既存レコードのセルから value/label 対応を集める（fields に choices が無いときの補助） */
export function collectSelectOptionsFromRecordCells(
  rows: AtPocketRecordRow[],
  handlerFieldId: string,
): AtPocketFieldOption[] {
  const id = handlerFieldId.trim();
  if (!id) return [];
  const byValue = new Map<string, AtPocketFieldOption>();

  for (const row of rows) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    collectOptionFromCell(readCell(rec as Record<string, unknown>, id), byValue);
  }
  return [...byValue.values()];
}

function collectOptionFromCell(
  raw: unknown,
  byValue: Map<string, AtPocketFieldOption>,
): void {
  if (raw === undefined || raw === null) return;
  if (Array.isArray(raw)) {
    for (const item of raw) collectOptionFromCell(item, byValue);
    return;
  }
  if (
    typeof raw === "string" ||
    typeof raw === "number" ||
    typeof raw === "boolean"
  ) {
    const t = String(raw).trim();
    if (!t || byValue.has(t)) return;
    byValue.set(t, { value: t, label: t });
    return;
  }
  if (typeof raw !== "object") return;
  const o = raw as Record<string, unknown>;
  const valueRaw = o.value ?? o.id;
  const labelRaw = o.label ?? o.text ?? o.displayValue ?? o.caption ?? o.name;
  const value =
    valueRaw == null
      ? ""
      : typeof valueRaw === "string" ||
          typeof valueRaw === "number" ||
          typeof valueRaw === "boolean"
        ? String(valueRaw).trim()
        : "";
  const label =
    labelRaw == null
      ? ""
      : typeof labelRaw === "string" ||
          typeof labelRaw === "number" ||
          typeof labelRaw === "boolean"
        ? String(labelRaw).trim()
        : "";
  if (!value && !label) return;
  const v = value || label;
  const l = label || value;
  const prev = byValue.get(v);
  if (!prev || (prev.label === prev.value && l !== v)) {
    byValue.set(v, { value: v, label: l });
  }
}

/**
 * スタッフ氏名を工事対応者（単一選択）への書き込み値に解決する。
 * 選択肢があるときは label（または value）一致の option.value を返す。
 */
export function resolveConstructionHandlerSelectWriteValue(
  staffName: string,
  options: AtPocketFieldOption[],
):
  | { ok: true; writeValue: string; matchedByOption: boolean }
  | { ok: false; reason: "empty_name" | "not_in_options" } {
  const name = nfkcNormalize(staffName);
  if (!name) return { ok: false, reason: "empty_name" };
  if (options.length === 0) {
    return { ok: true, writeValue: staffName.trim(), matchedByOption: false };
  }

  for (const opt of options) {
    if (optionNormKeys(opt).includes(name)) {
      return { ok: true, writeValue: opt.value, matchedByOption: true };
    }
  }
  return { ok: false, reason: "not_in_options" };
}

/** fields 定義と既存セルの両方から選択肢を合成して書き込み値を決める */
export function resolveConstructionHandlerWriteValue(opts: {
  staffName: string;
  handlerFieldId: string;
  constructionFields: AtPocketFieldRow[];
  sampleRows?: AtPocketRecordRow[];
}):
  | { ok: true; writeValue: string; displayName: string }
  | { ok: false; reason: "empty_name" | "not_in_options" } {
  const displayName = opts.staffName.trim();
  if (!nfkcNormalize(displayName)) {
    return { ok: false, reason: "empty_name" };
  }

  const fromFields = extractConstructionHandlerFieldOptions(
    opts.constructionFields,
    opts.handlerFieldId,
  );
  // フィールド定義に選択肢があるときは厳格一致（一致しない氏名は書き込まない）
  if (fromFields.length > 0) {
    const resolved = resolveConstructionHandlerSelectWriteValue(
      displayName,
      fromFields,
    );
    if (!resolved.ok) return resolved;
    return {
      ok: true,
      writeValue: resolved.writeValue,
      displayName,
    };
  }

  // 定義に choices が無い場合は既存レコードから推定。無ければ氏名文字列を送る
  const fromRows = opts.sampleRows?.length
    ? collectSelectOptionsFromRecordCells(opts.sampleRows, opts.handlerFieldId)
    : [];
  if (fromRows.length > 0) {
    const resolved = resolveConstructionHandlerSelectWriteValue(
      displayName,
      fromRows,
    );
    if (resolved.ok && resolved.matchedByOption) {
      return {
        ok: true,
        writeValue: resolved.writeValue,
        displayName,
      };
    }
    // 既存セルが「value≠label」なら選択肢ID型とみなし、未一致は失敗にする
    const looksLikeOptionIds = fromRows.some(
      (o) => o.value !== o.label && o.value.length > 0 && o.label.length > 0,
    );
    if (looksLikeOptionIds) {
      return { ok: false, reason: "not_in_options" };
    }
  }

  return { ok: true, writeValue: displayName, displayName };
}
