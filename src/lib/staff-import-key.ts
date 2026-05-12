import "server-only";

export function staffImportKeyFieldIdEnv(): string | undefined {
  const id = process.env.STAFF_IMPORT_KEY_FIELD_ID?.trim();
  return id || undefined;
}

/** STAFF_BIND_ALWAYS_INCLUDE_FIELD_IDS の先頭のみを取込キー相当として使う（IMPORT_KEY 未設定時の互換） */
function firstBindAlwaysIncludeFieldId(): string | undefined {
  const csv = process.env.STAFF_BIND_ALWAYS_INCLUDE_FIELD_IDS?.trim();
  if (!csv) return undefined;
  const first = csv.split(",")[0]?.trim();
  return first || undefined;
}

/**
 * 取込キー「社員ID」列の uniqueId。
 * 明示は STAFF_IMPORT_KEY_FIELD_ID。無ければ STAFF_BIND_ALWAYS_INCLUDE_FIELD_IDS の先頭を利用する。
 */
export function staffImportKeyFieldIdResolved(): string | undefined {
  return staffImportKeyFieldIdEnv() ?? firstBindAlwaysIncludeFieldId();
}

export function recordValueLooksPresent(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  return true;
}

function importKeySourceFieldIds(): string[] {
  return (
    process.env.STAFF_IMPORT_KEY_SOURCE_FIELD_IDS?.trim()
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? []
  );
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
