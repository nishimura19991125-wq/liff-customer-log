/**
 * 更新履歴アプリ「変更内容」列の文字列を組み立てる純粋関数群。
 * @pocket にも Next にも依存しないのでそのまま単体テストできる。
 *
 * 既存の別システム（Google アカウントでログインする方）が書き込んでいる行と
 * 同じ書式に揃える。記号を1文字でも変えると既存行と混ざったとき見分けがつかなくなるため、
 * 区切り文字は下の定数に集約し、テストで固定している。
 *   例: 「備考: （空） → 特になし」
 */

/** 値の区切り。全角矢印の前後に半角スペース1つ */
export const AUDIT_ARROW = " → ";
/** 値が無いことを表す（全角括弧） */
export const AUDIT_EMPTY = "（空）";
/** 削除操作で「変更後」に置く（全角括弧） */
export const AUDIT_DELETED = "（削除）";
/** ラベルと値の区切り */
export const AUDIT_LABEL_SEPARATOR = ": ";
/** 値の既定の最大長（AUDIT_LOG_VALUE_MAX_LENGTH で上書き） */
export const AUDIT_DEFAULT_VALUE_MAX_LENGTH = 200;
/** 切り詰めたことを示す記号 */
export const AUDIT_TRUNCATED = "…";

export type AuditLogFieldChange = {
  /** @pocket のスキーマ uniqueId */
  fieldId: string;
  /** 人が読めるラベル（@pocket の見出し）。解決できないときは fieldId をそのまま入れる */
  label: string;
  before: string;
  after: string;
};

/** @pocket の値（文字列 / 数値 / {value,label} / 配列 / テーブル）を比較用の文字列にする */
export function auditValueToString(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") return foldWhitespace(raw);
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw).trim();
  }
  if (Array.isArray(raw)) {
    return raw
      .map((item) => auditValueToString(item))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    // 選択肢列は value が選択肢ID のことがあるのでラベル系を優先する
    for (const key of ["label", "text", "displayValue", "caption", "name"]) {
      const v = o[key];
      if (typeof v === "string" && v.trim()) return foldWhitespace(v);
    }
    const value = o.value;
    if (typeof value === "string") return foldWhitespace(value);
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value).trim();
    }
    if (value !== undefined && value !== null) return auditValueToString(value);
    try {
      return foldWhitespace(JSON.stringify(raw));
    } catch {
      return "";
    }
  }
  return foldWhitespace(String(raw));
}

/** 改行・タブ・連続空白を半角スペース1つに畳む（1行1レコードの書式を壊さないため） */
function foldWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** 「値なし」を表す表記のゆれ（"" / "-" / "－"）を同一視する比較キー */
function comparisonKey(s: string): string {
  const t = s.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (t === "-" || t === "－") return "";
  return t;
}

/** 表示用。空値は「（空）」、長すぎる値は切り詰めて「…」を付ける */
export function formatAuditValue(
  raw: string,
  maxLength = AUDIT_DEFAULT_VALUE_MAX_LENGTH,
): string {
  const folded = foldWhitespace(raw);
  if (comparisonKey(folded) === "") return AUDIT_EMPTY;
  if (folded.length <= maxLength) return folded;
  return `${folded.slice(0, maxLength)}${AUDIT_TRUNCATED}`;
}

export type ComputeAuditChangesOptions = {
  /** fieldId → 表示ラベル。解決できない場合は fieldId を使う */
  labelOf?: (fieldId: string) => string | null | undefined;
  /** 値を記録しない列（PIN 等）。差分検知はするが値を伏せる */
  redactFieldIds?: ReadonlySet<string>;
};

export const AUDIT_REDACTED = "（記録対象外）";

/**
 * 更新後 payload に含まれる列だけを対象に差分を取る。
 * payload に無い列は「触っていない」ので比較しない（@pocket は部分更新のため）。
 */
export function computeAuditChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
  options: ComputeAuditChangesOptions = {},
): AuditLogFieldChange[] {
  const redact = options.redactFieldIds;
  const changes: AuditLogFieldChange[] = [];

  for (const fieldId of Object.keys(after)) {
    const afterStr = auditValueToString(after[fieldId]);
    const beforeStr = before ? auditValueToString(before[fieldId]) : "";
    if (comparisonKey(beforeStr) === comparisonKey(afterStr)) continue;

    const label = options.labelOf?.(fieldId)?.trim() || fieldId;
    const redacted = redact?.has(fieldId) === true;
    changes.push({
      fieldId,
      label,
      before: redacted ? AUDIT_REDACTED : beforeStr,
      after: redacted ? AUDIT_REDACTED : afterStr,
    });
  }

  changes.sort((a, b) => a.label.localeCompare(b.label, "ja"));
  return changes;
}

/** 1変更＝1行。「<項目ラベル>: <変更前> → <変更後>」 */
export function formatChangeLine(
  change: AuditLogFieldChange,
  maxLength = AUDIT_DEFAULT_VALUE_MAX_LENGTH,
): string {
  const before = formatAuditValue(change.before, maxLength);
  const after = formatAuditValue(change.after, maxLength);
  return `${change.label}${AUDIT_LABEL_SEPARATOR}${before}${AUDIT_ARROW}${after}`;
}

/**
 * 削除操作の「変更内容」。全項目を改行区切りで1レコードにまとめる（A-4）。
 * 各行は「<項目ラベル>: <値> → （削除）」。
 */
export function formatDeletionContent(
  record: Record<string, unknown>,
  options: ComputeAuditChangesOptions & { maxLength?: number } = {},
): string {
  const maxLength = options.maxLength ?? AUDIT_DEFAULT_VALUE_MAX_LENGTH;
  const redact = options.redactFieldIds;

  // 物理削除は不可逆でログが唯一の復元手段なので、空の項目も省かず全項目を並べる（A-4 完全性優先）
  const lines: string[] = [];
  for (const fieldId of Object.keys(record)) {
    const value = auditValueToString(record[fieldId]);
    const label = options.labelOf?.(fieldId)?.trim() || fieldId;
    const shown = redact?.has(fieldId) === true
      ? AUDIT_REDACTED
      : formatAuditValue(value, maxLength);
    lines.push(
      `${label}${AUDIT_LABEL_SEPARATOR}${shown}${AUDIT_ARROW}${AUDIT_DELETED}`,
    );
  }

  lines.sort((a, b) => a.localeCompare(b, "ja"));
  return lines.join("\n");
}

/**
 * 1操作あたりのレコード数上限を超えた分をまとめる1行（A-1）。
 * 「他N件の項目を変更（項目名A, 項目名B, ...）」— 値は省略する。
 */
export function formatOverflowSummary(
  overflow: readonly AuditLogFieldChange[],
): string {
  if (overflow.length === 0) return "";
  const labels = overflow.map((c) => c.label).join(", ");
  return `他${overflow.length}件の項目を変更（${labels}）`;
}
