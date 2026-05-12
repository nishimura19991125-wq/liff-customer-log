import "server-only";

/** @pocket スタッフ名簿の LINE ユーザーIDフィールド値を比較用に正規化 */
export function normalizeStaffLineUserId(raw: unknown): string {
  if (raw == null) return "";
  return String(raw).replace(/\s/g, "").trim();
}

/** 1レコードあたり最大2つの LINE ID フィールドのいずれかが一致するか */
export function staffRecordMatchesLineUser(
  record: Record<string, unknown>,
  lineField1: string,
  lineField2: string | undefined,
  lineUserId: string,
): boolean {
  const want = lineUserId.replace(/\s/g, "").trim();
  if (!want) return false;
  const a = normalizeStaffLineUserId(record[lineField1]);
  if (a && a === want) return true;
  if (lineField2) {
    const b = normalizeStaffLineUserId(record[lineField2]);
    if (b && b === want) return true;
  }
  return false;
}

export type BindLineSlotResult =
  | { kind: "already" }
  | { kind: "field"; fieldId: string; value: string }
  | { kind: "full" };

/** 選択したスタッフレコードに、caller の LINE ID を書き込めるか（空きスロット／既に同一なら already） */
export function resolveBindLineSlot(
  record: Record<string, unknown>,
  lineField1: string,
  lineField2: string | undefined,
  callerLineUserId: string,
): BindLineSlotResult {
  const want = callerLineUserId.replace(/\s/g, "").trim();
  if (!want) return { kind: "full" };

  const v1 = normalizeStaffLineUserId(record[lineField1]);
  const v2 = lineField2 ? normalizeStaffLineUserId(record[lineField2]) : "";

  if (v1 === want || v2 === want) return { kind: "already" };
  if (!v1) return { kind: "field", fieldId: lineField1, value: want };
  if (lineField2 && !v2) return { kind: "field", fieldId: lineField2, value: want };
  return { kind: "full" };
}
