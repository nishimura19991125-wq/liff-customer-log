import "server-only";

export type StaffLineUserIdFieldIds = {
  /** LINE_USER_ID①（@pocket の uniqueId。例: field-12） */
  lineField1?: string;
  /** LINE_USER_ID② */
  lineField2?: string;
};

/** ①: STAFF_LINE_USER_ID_1_FIELD_ID または STAFF_LINE_USER_ID_FIELD_ID */
export function staffLineUserIdField1FromEnv(): string | undefined {
  const id =
    process.env.STAFF_LINE_USER_ID_1_FIELD_ID?.trim() ||
    process.env.STAFF_LINE_USER_ID_FIELD_ID?.trim();
  return id || undefined;
}

/** ②: STAFF_LINE_USER_ID_2_FIELD_ID または STAFF_LINE_USER_ID_FIELD_ID_2 */
export function staffLineUserIdField2FromEnv(): string | undefined {
  const id =
    process.env.STAFF_LINE_USER_ID_2_FIELD_ID?.trim() ||
    process.env.STAFF_LINE_USER_ID_FIELD_ID_2?.trim();
  return id || undefined;
}

/** 環境変数から LINE_USER_ID①・② の uniqueId を取得 */
export function staffLineUserIdFieldIdsFromEnv(): StaffLineUserIdFieldIds {
  const lineField1 = staffLineUserIdField1FromEnv();
  const lineField2 = staffLineUserIdField2FromEnv();
  return {
    ...(lineField1 ? { lineField1 } : {}),
    ...(lineField2 ? { lineField2 } : {}),
  };
}

/** ①②とも設定済みのときのみ LINE 紐付け・照合を有効化 */
export function staffLineBindingEnabled(ids: StaffLineUserIdFieldIds): boolean {
  return Boolean(ids.lineField1 && ids.lineField2);
}

export function staffLineBindingConfigError(): string | null {
  const ids = staffLineUserIdFieldIdsFromEnv();
  if (staffLineBindingEnabled(ids)) return null;
  const missing: string[] = [];
  if (!ids.lineField1) {
    missing.push(
      "STAFF_LINE_USER_ID_1_FIELD_ID（または STAFF_LINE_USER_ID_FIELD_ID）",
    );
  }
  if (!ids.lineField2) {
    missing.push(
      "STAFF_LINE_USER_ID_2_FIELD_ID（または STAFF_LINE_USER_ID_FIELD_ID_2）",
    );
  }
  return `LINE 紐付け用の環境変数が不足しています: ${missing.join("、")}`;
}

/** @deprecated staffAppId は互換のため受け取るが参照しない */
export async function fetchStaffLineUserIdFieldIds(
  _staffAppId?: string,
): Promise<StaffLineUserIdFieldIds> {
  return staffLineUserIdFieldIdsFromEnv();
}

/** fields CSV 用（①②の両方を必ず含める） */
export function staffLineUserIdFieldsCsv(ids: StaffLineUserIdFieldIds): string {
  const parts: string[] = [];
  if (ids.lineField1) parts.push(ids.lineField1);
  if (ids.lineField2 && ids.lineField2 !== ids.lineField1) {
    parts.push(ids.lineField2);
  }
  return parts.join(",");
}
