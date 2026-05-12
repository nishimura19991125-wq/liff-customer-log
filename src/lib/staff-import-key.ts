import "server-only";

export function staffImportKeyFieldIdEnv(): string | undefined {
  const id = process.env.STAFF_IMPORT_KEY_FIELD_ID?.trim();
  return id || undefined;
}

/** STAFF_BIND_ALWAYS_INCLUDE_FIELD_IDS を順に分割（カンマ区切り） */
function bindAlwaysIncludeFieldIdsInOrder(): string[] {
  const csv = process.env.STAFF_BIND_ALWAYS_INCLUDE_FIELD_IDS?.trim();
  if (!csv) return [];
  return csv.split(",").map((s) => s.trim()).filter(Boolean);
}

/** API が返す `field-5` 形式。PUT の宛先 uniqueId としては使わない（誤設定が多いため） */
function isLegacyHyphenNumericFieldKey(id: string): boolean {
  return /^field-\d+$/i.test(id);
}

/**
 * 取込キー「社員ID」列の uniqueId。
 * - STAFF_IMPORT_KEY_FIELD_ID が最優先
 * - 無ければ STAFF_BIND_ALWAYS_INCLUDE_FIELD_IDS のうち **field-数字 以外** の先頭（@pocket 管理画面の正式 uniqueId）
 *
 * `field-1` のみを BIND に置くのは誤り。**値の取り元**は STAFF_IMPORT_KEY_SOURCE_FIELD_IDS か、BIND 内の field-* に書く。
 */
export function staffImportKeyFieldIdResolved(): string | undefined {
  const explicit = staffImportKeyFieldIdEnv();
  if (explicit) return explicit;
  for (const id of bindAlwaysIncludeFieldIdsInOrder()) {
    if (!isLegacyHyphenNumericFieldKey(id)) return id;
  }
  return undefined;
}

export function recordValueLooksPresent(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  return true;
}

function importKeySourceFieldIds(): string[] {
  const fromEnv =
    process.env.STAFF_IMPORT_KEY_SOURCE_FIELD_IDS?.trim()
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const fromBindLegacy = bindAlwaysIncludeFieldIdsInOrder().filter((id) =>
    isLegacyHyphenNumericFieldKey(id),
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of [...fromEnv, ...fromBindLegacy]) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

/** 一覧・単体 GET の生 record から取込キー相当の表示用文字列を取る（LIFF への返却用） */
export function readStaffImportKeyFromRawRecord(
  rawRecord: Record<string, unknown>,
): string {
  const dest = staffImportKeyFieldIdResolved();
  if (!dest) return "";
  if (recordValueLooksPresent(rawRecord[dest])) {
    return String(rawRecord[dest]).trim();
  }
  for (const sk of importKeySourceFieldIds()) {
    const v = rawRecord[sk];
    if (recordValueLooksPresent(v)) return String(v).trim();
  }
  const legacy = Object.entries(rawRecord).filter(
    ([k, v]) => /^field-\d+$/i.test(k) && recordValueLooksPresent(v),
  );
  if (legacy.length === 1) return String(legacy[0][1]).trim();
  return "";
}

/**
 * GET が `field-5` のみ返す取込キーを strip で落とすと PUT が 400 になる。
 * STAFF_IMPORT_KEY_FIELD_ID に正式な uniqueId を設定し、元レコードの別キーから値を移す。
 */
export function enrichCleanedRecordWithImportKey(
  rawRecord: Record<string, unknown>,
  cleanedRecord: Record<string, unknown>,
): Record<string, unknown> {
  const dest = staffImportKeyFieldIdResolved();
  if (!dest) return cleanedRecord;

  if (recordValueLooksPresent(cleanedRecord[dest])) {
    return cleanedRecord;
  }

  for (const sk of importKeySourceFieldIds()) {
    const v = rawRecord[sk];
    if (recordValueLooksPresent(v)) {
      return { ...cleanedRecord, [dest]: v };
    }
  }

  const legacyFieldEntries = Object.entries(rawRecord).filter(
    ([k, v]) => /^field-\d+$/i.test(k) && recordValueLooksPresent(v),
  );
  if (legacyFieldEntries.length === 1) {
    return { ...cleanedRecord, [dest]: legacyFieldEntries[0][1] };
  }

  return cleanedRecord;
}

/** 単体 GET の fields に渡す CSV（欠けやすい列を明示取得） */
export function staffRecordRefreshFieldsCsv(opts: {
  staffNameFieldId: string;
  lineField1: string;
  lineField2?: string;
}): string {
  const ids = new Set<string>();
  const add = (s?: string) => {
    const t = s?.trim();
    if (t) ids.add(t);
  };
  add(opts.staffNameFieldId);
  add(opts.lineField1);
  add(opts.lineField2);
  add(staffImportKeyFieldIdResolved());
  for (const x of importKeySourceFieldIds()) add(x);
  const extra =
    process.env.STAFF_BIND_ALWAYS_INCLUDE_FIELD_IDS?.trim()
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  for (const x of extra) add(x);
  return [...ids].join(",");
}
