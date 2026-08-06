import "server-only";

import { createRecord, fetchAppFields } from "@/lib/atpocket";
import type { AuditLogFieldChange } from "@/lib/audit-log-changes";
import {
  AUDIT_DEFAULT_VALUE_MAX_LENGTH,
  formatChangeLine,
  formatOverflowSummary,
} from "@/lib/audit-log-changes";
import {
  auditLogFieldsConfigured,
  missingAuditLogFieldLabels,
  resolveAuditLogFieldIds,
  type AuditLogFieldIds,
} from "@/lib/audit-log-fields";
import {
  boundStaffEntryFromRosterRows,
  fetchStaffRosterRowsCached,
} from "@/lib/staff-roster-cache";

/**
 * 既存の「更新履歴」アプリへの監査ログ記録。
 *
 * 設計上の約束:
 *  - 記録の入口は `recordAuditLog` 1本のみ。ほかに書き込み口を作らない。
 *  - **追記のみ**。既存行を読む・更新する処理は書かない（別システムも書き込んでいるため）。
 *  - 実行者は **必ず lineUserId からサーバ側で解決する**。呼び出し側が名前やメールを渡す口は無い。
 *  - 1変更＝1レコード（A-1）。削除だけは全項目を1レコードにまとめる（A-4）。
 *  - 相関ID列は無い。同一操作の複数行は **実行日時の一致** で束ねるため、
 *    1操作の全レコードで同じタイムスタンプを使う。
 *  - 作成・更新はベストエフォート（A-5）。削除は失敗を呼び出し側へ返す（A-4）。
 */

export type AuditLogOperation = "create" | "update" | "delete";

type AuditLogEntryBase = {
  /** 呼び出し元の LINE userId（`auth.lineUserId`）。実行者はここから解決する */
  lineUserId: string;
  /** @pocket の appsId（既存例「12」と同じ形式） */
  targetAppId: string;
  /** @pocket の recordId（既存例「1483」） */
  targetRecordId: string;
  /** 対象T番（既存例「T00001691」）。無ければ省略 */
  targetTNumber?: string;
};

export type AuditLogEntry =
  | (AuditLogEntryBase & {
      operation: "create" | "update";
      changes: readonly AuditLogFieldChange[];
    })
  | (AuditLogEntryBase & {
      operation: "delete";
      /** formatDeletionContent() で組み立てた改行区切りの本文 */
      deletionContent: string;
    });

export type AuditLogWriteResult =
  | { ok: true; written: number }
  | { ok: false; error: string };

// ─────────────────────────── A-6 本番でのフェイルオープン防止

/**
 * 本番で AUDIT_LOG_APP_ID の設定漏れが無音で通ると、
 * 将来 B-3（403撤廃）と組み合わさったとき「監査ログも認可も無い」状態が生まれ、
 * 症状が出ないため発覚しない。そのため起動時に落とす。
 *
 * ビルド時は環境変数が揃っていないことがあり、Next 自身も
 * `process.env.NEXT_PHASE === "phase-production-build"` でビルドフェーズを判定しているため、
 * その間だけ除外する（実行時のチェックは維持される）。
 */
if (
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build" &&
  !process.env.AUDIT_LOG_APP_ID?.trim()
) {
  throw new Error(
    "[audit-log] 本番環境で AUDIT_LOG_APP_ID が未設定です。監査ログが記録されないまま顧客データが更新されるため起動を中止します。更新履歴アプリの appsId を設定してください。",
  );
}

// ───────────────────────────────── 失敗カウンタ（A-5 の観測要件）

type AuditLogStats = {
  attempted: number;
  succeeded: number;
  failed: number;
  lastFailureAt: string | null;
  lastFailureTarget: string | null;
  lastFailureMessage: string | null;
};

const stats: AuditLogStats = {
  attempted: 0,
  succeeded: 0,
  failed: 0,
  lastFailureAt: null,
  lastFailureTarget: null,
  lastFailureMessage: null,
};

/**
 * 監査ログの記録状況（読み取り専用）。
 * ベストエフォートの弱点は「失敗が静かに握り潰される」ことなので観測手段を用意する。
 * 露出方法（/api/health 等）は B-2 完了後に決めるため、ここでは export のみ。
 */
export function auditLogStats(): Readonly<AuditLogStats> {
  return { ...stats };
}

// ───────────────────────────────────────────────── 設定

function auditLogApiKey(): string | undefined {
  for (const name of [
    "AUDIT_LOG_ATPOCKET_API_KEY",
    "AUDIT_LOG_ATPOCKET_API_KEY_1",
    "AUDIT_LOG_ATPOCKET_API_KEY_2",
  ]) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return undefined;
}

export function auditLogEnabled(): boolean {
  return Boolean(process.env.AUDIT_LOG_APP_ID?.trim() && auditLogApiKey());
}

function valueMaxLength(): number {
  const raw = process.env.AUDIT_LOG_VALUE_MAX_LENGTH?.trim();
  const n = raw ? Number(raw) : AUDIT_DEFAULT_VALUE_MAX_LENGTH;
  if (!Number.isFinite(n) || n < 10) return AUDIT_DEFAULT_VALUE_MAX_LENGTH;
  return Math.min(5000, Math.floor(n));
}

function maxRowsPerOperation(): number {
  const raw = process.env.AUDIT_LOG_MAX_ROWS_PER_OPERATION?.trim();
  const n = raw ? Number(raw) : 30;
  if (!Number.isFinite(n) || n < 1) return 30;
  return Math.min(200, Math.floor(n));
}

function actionLabel(operation: AuditLogOperation): string {
  switch (operation) {
    case "create":
      return process.env.AUDIT_LOG_ACTION_LABEL_CREATE?.trim() || "LIFF登録";
    case "delete":
      return process.env.AUDIT_LOG_ACTION_LABEL_DELETE?.trim() || "LIFF削除";
    default:
      return process.env.AUDIT_LOG_ACTION_LABEL_UPDATE?.trim() || "LIFF編集";
  }
}

/** JST の "YYYY-MM-DD HH:mm:ss"（sv-SE ロケールがこの形式を返す） */
function jstTimestamp(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(now)
    .replace("T", " ");
}

// ────────────────────────────────────── 列定義キャッシュ

let fieldIdsCache: { appId: string; ids: AuditLogFieldIds } | null = null;

async function resolveFieldIds(
  appId: string,
  apiKey: string,
): Promise<AuditLogFieldIds | null> {
  if (fieldIdsCache && fieldIdsCache.appId === appId) return fieldIdsCache.ids;

  const fields = await fetchAppFields(
    appId,
    { apiKey },
    { operation: "audit-log:列定義", appEnv: "AUDIT_LOG_APP_ID" },
  );
  const ids = resolveAuditLogFieldIds(fields);
  if (!auditLogFieldsConfigured(ids)) {
    console.error(
      "[audit-log] 更新履歴アプリの必須列を解決できません:",
      missingAuditLogFieldLabels(ids).join(" / "),
      "— AUDIT_LOG_*_FIELD_ID を設定するか @pocket の列見出しを確認してください",
    );
    return null;
  }
  if (!ids.targetTNumber) {
    console.warn(
      "[audit-log] 「対象T番」列を解決できません。T番号なしで記録を続けます",
    );
  }
  fieldIdsCache = { appId, ids };
  return ids;
}

/** @pocket で列を改名した直後に呼ぶ */
export function invalidateAuditLogFieldIdsCache(): void {
  fieldIdsCache = null;
}

// ───────────────────────── 実行者の解決（A-2・サーバ側のみ）

/**
 * 「実行者」列に入れる値。既存システムはメールアドレス（例: n-nishimura@truach.co.jp）を書く。
 * メール未登録でも記録は止めない（ログ欠落の方が有害）。
 */
async function resolveActor(lineUserId: string): Promise<string> {
  const want = lineUserId.trim();
  if (!want) {
    console.warn("[audit-log] lineUserId が空のため実行者を特定できません");
    return "liff:unknown";
  }

  let entry: Awaited<ReturnType<typeof boundStaffEntryFromRosterRows>> = null;
  try {
    entry = boundStaffEntryFromRosterRows(
      await fetchStaffRosterRowsCached(),
      want,
    );
  } catch (e) {
    console.warn("[audit-log] 名簿の取得に失敗し実行者を特定できません", e);
    return "liff:unknown";
  }

  if (entry?.email) return entry.email;

  if (entry?.staffCode) {
    console.warn(
      `[audit-log] スタッフ「${entry.name}」にメールアドレスが未登録です。実行者を社員IDで記録します`,
    );
    return `liff:${entry.staffCode}`;
  }

  console.warn(
    "[audit-log] 実行者のメールアドレス・社員IDのいずれも取得できませんでした",
  );
  return "liff:unknown";
}

// ─────────────────────────────────────────────── 書き込み

function buildRow(
  ids: AuditLogFieldIds,
  entry: AuditLogEntry,
  actor: string,
  executedAt: string,
  changeContent: string,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const set = (fieldId: string | null, value: string) => {
    if (fieldId) row[fieldId] = value;
  };

  set(ids.executedAt, executedAt);
  set(ids.actor, actor);
  set(ids.action, actionLabel(entry.operation));
  set(ids.targetAppId, entry.targetAppId);
  set(ids.targetRecordId, entry.targetRecordId);
  set(ids.targetTNumber, entry.targetTNumber ?? "");
  set(ids.change, changeContent);

  return row;
}

/** 「変更内容」の本文一覧を作る。1要素＝1レコード */
function buildChangeContents(entry: AuditLogEntry): string[] {
  if (entry.operation === "delete") {
    // A-4: 削除は全項目を改行区切りで1レコードにまとめる（30件上限の対象外）
    return entry.deletionContent ? [entry.deletionContent] : [];
  }

  const max = valueMaxLength();
  const changes = entry.changes;
  if (changes.length === 0) return [];

  const rowCap = maxRowsPerOperation();
  if (changes.length <= rowCap) {
    return changes.map((c) => formatChangeLine(c, max));
  }

  // A-1: 上限に収まるよう、末尾1レコードを超過分のまとめにする
  const detailCount = Math.max(0, rowCap - 1);
  const detail = changes.slice(0, detailCount);
  const overflow = changes.slice(detailCount);
  console.warn(
    `[audit-log] 変更 ${changes.length} 件が1操作あたりの上限 ${rowCap} レコードを超えました。` +
      `${overflow.length} 件は項目名のみのまとめ行にします（AUDIT_LOG_MAX_ROWS_PER_OPERATION）`,
  );
  return [
    ...detail.map((c) => formatChangeLine(c, max)),
    formatOverflowSummary(overflow),
  ];
}

function noteFailure(target: string, message: string, cause?: unknown): void {
  stats.failed++;
  stats.lastFailureAt = jstTimestamp();
  stats.lastFailureTarget = target;
  stats.lastFailureMessage = message;
  console.error(
    `[audit-log] 監査ログの記録に失敗しました target=${target} failedTotal=${stats.failed}: ${message}`,
    cause ?? "",
  );
}

/** 1レコード書き込む。1回だけ即時リトライする（A-5） */
async function createRowWithRetry(
  appId: string,
  apiKey: string,
  row: Record<string, unknown>,
  target: string,
): Promise<void> {
  try {
    await createRecord(appId, row, { apiKey });
  } catch (firstError) {
    console.warn(
      `[audit-log] 記録に失敗。1度だけ再試行します target=${target}`,
      firstError,
    );
    await createRecord(appId, row, { apiKey });
  }
}

/**
 * 監査ログを記録する。
 *
 * - 作成・更新: **throw しない**。失敗しても業務更新を巻き添えにしない（A-5）。
 * - 削除: 呼び出し側は戻り値の `ok` を確認し、false なら `deleteRecord` を実行しないこと（A-4）。
 */
export async function recordAuditLog(
  entry: AuditLogEntry,
): Promise<AuditLogWriteResult> {
  const target = `${entry.targetAppId}/${entry.targetRecordId}`;

  const contents = buildChangeContents(entry);

  if (contents.length === 0) {
    // 削除だけは別扱い。項目を1つも取れていない状態でログ無しの削除を許すと
    // 復元手段が消えるので、呼び出し側に失敗を返して削除を止めさせる（A-4）。
    if (entry.operation === "delete") {
      const message =
        "削除対象の項目を取得できなかったため、削除ログを作成できません";
      noteFailure(target, message);
      return { ok: false, error: message };
    }
    // 変更なしの保存では1レコードも書かない（@pocket も呼ばない）
    return { ok: true, written: 0 };
  }

  const appId = process.env.AUDIT_LOG_APP_ID?.trim();
  const apiKey = auditLogApiKey();
  if (!appId || !apiKey) {
    const message =
      "AUDIT_LOG_APP_ID / AUDIT_LOG_ATPOCKET_API_KEY が未設定です";
    // 本番は A-6 で起動時に落ちているので、ここに来るのは開発環境のみ
    noteFailure(target, message);
    return { ok: false, error: message };
  }

  stats.attempted += contents.length;

  let ids: AuditLogFieldIds | null;
  let actor: string;
  try {
    [ids, actor] = await Promise.all([
      resolveFieldIds(appId, apiKey),
      resolveActor(entry.lineUserId),
    ]);
  } catch (e) {
    fieldIdsCache = null;
    const message = e instanceof Error ? e.message : String(e);
    stats.attempted -= contents.length;
    for (let i = 0; i < contents.length; i++) noteFailure(target, message, e);
    return { ok: false, error: message };
  }

  if (!ids) {
    const message = "更新履歴アプリの列を解決できません";
    for (let i = 0; i < contents.length; i++) noteFailure(target, message);
    return { ok: false, error: message };
  }

  // 相関ID列が無いため、同一操作の複数行は「実行日時の一致」でのみ束ねられる。
  // したがって全レコードで同じタイムスタンプを使うこと。
  const executedAt = jstTimestamp();

  let written = 0;
  let lastError = "";
  for (const content of contents) {
    const row = buildRow(ids, entry, actor, executedAt, content);
    try {
      await createRowWithRetry(appId, apiKey, row, target);
      written++;
      stats.succeeded++;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      noteFailure(target, lastError, e);
    }
  }

  if (written === contents.length) return { ok: true, written };
  return {
    ok: false,
    error: `${contents.length} 件中 ${written} 件のみ記録できました: ${lastError}`,
  };
}
