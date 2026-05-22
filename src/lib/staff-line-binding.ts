import "server-only";

function stripSpaces(s: string): string {
  return s.replace(/\s/g, "").trim();
}

/**
 * @pocket のフィールド値をフラットな文字列にする。
 * 一覧 API でオブジェクト・配列になるタイプ（選択肢・リンク等）でも照合できるようにする。
 */
function coercePocketFieldToPlainString(raw: unknown): string {
  if (raw == null) return "";
  if (
    typeof raw === "string" ||
    typeof raw === "number" ||
    typeof raw === "boolean"
  ) {
    return String(raw);
  }
  if (Array.isArray(raw)) {
    return raw.map(coercePocketFieldToPlainString).filter(Boolean).join(" ");
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const k of [
      "value",
      "text",
      "displayValue",
      "label",
      "name",
      "caption",
    ]) {
      if (o[k] != null) {
        const s = coercePocketFieldToPlainString(o[k]);
        if (s) return s;
      }
    }
    return Object.values(o)
      .map(coercePocketFieldToPlainString)
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

/** フィールド全体を空白扱いか（紐付け先スロットが空か） */
function isStaffLineFieldEffectivelyEmpty(raw: unknown): boolean {
  return !stripSpaces(coercePocketFieldToPlainString(raw));
}

/**
 * @pocket に保存された値から LINE ユーザー ID 照合用の候補を集める。
 * セルに「コメント + U…」が混在していても U で始まるトークンを拾う。
 */
function lineUserIdMatchCandidatesFromPocketField(
  raw: unknown,
): Set<string> {
  const plain = coercePocketFieldToPlainString(raw);
  const compact = stripSpaces(plain);
  const out = new Set<string>();
  if (compact) out.add(compact);
  const re = /U[A-Za-z0-9+/=_-]{10,}/g;
  let m: RegExpExecArray | null;
  const haystack = plain.length >= compact.length ? plain : compact;
  re.lastIndex = 0;
  while ((m = re.exec(haystack)) !== null) {
    out.add(stripSpaces(m[0]));
  }
  return out;
}

function pocketFieldContainsLineUserId(
  raw: unknown,
  lineUserId: string,
): boolean {
  const want = stripSpaces(lineUserId);
  if (!want) return false;
  for (const c of lineUserIdMatchCandidatesFromPocketField(raw)) {
    if (c === want) return true;
  }
  return false;
}

export function normalizeStaffLineUserId(raw: unknown): string {
  return stripSpaces(coercePocketFieldToPlainString(raw));
}

/** 1レコードあたり LINE_USER_ID①・② のいずれかが一致するか */
export function staffRecordMatchesLineUser(
  record: Record<string, unknown>,
  lineField1: string | undefined,
  lineField2: string | undefined,
  lineUserId: string,
): boolean {
  const want = stripSpaces(lineUserId);
  if (!want) return false;
  if (lineField1 && pocketFieldContainsLineUserId(record[lineField1], want)) {
    return true;
  }
  if (lineField2 && pocketFieldContainsLineUserId(record[lineField2], want)) {
    return true;
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
  lineField1: string | undefined,
  lineField2: string | undefined,
  callerLineUserId: string,
): BindLineSlotResult {
  const want = stripSpaces(callerLineUserId);
  if (!want || (!lineField1 && !lineField2)) return { kind: "full" };

  if (lineField1 && pocketFieldContainsLineUserId(record[lineField1], want)) {
    return { kind: "already" };
  }
  if (lineField2 && pocketFieldContainsLineUserId(record[lineField2], want)) {
    return { kind: "already" };
  }

  const slot1Empty = lineField1
    ? isStaffLineFieldEffectivelyEmpty(record[lineField1])
    : true;
  const slot2Empty = lineField2
    ? isStaffLineFieldEffectivelyEmpty(record[lineField2])
    : true;

  if (lineField1 && slot1Empty) {
    return { kind: "field", fieldId: lineField1, value: want };
  }
  if (lineField2 && slot2Empty) {
    return { kind: "field", fieldId: lineField2, value: want };
  }
  return { kind: "full" };
}
