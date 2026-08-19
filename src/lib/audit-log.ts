import "server-only";

import {
  createRecord,
  fetchAppFields,
  isPocketHttpRateLimitError,
  pocketRetryAfterMsFromError,
} from "@/lib/atpocket";
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
  /** 再試行して成功した件数（初回で成功した分は含まない） */
  succeededAfterRetry: number;
  /** 429 が理由で失敗した件数（クールダウン中の即失敗も含む） */
  failedRateLimited: number;
  /** 429 以外の理由で失敗した件数 */
  failedOther: number;
  /** failedRateLimited のうち、クールダウン中で再試行せずに失敗した件数 */
  skippedByCooldown: number;
};

const stats: AuditLogStats = {
  attempted: 0,
  succeeded: 0,
  failed: 0,
  lastFailureAt: null,
  lastFailureTarget: null,
  lastFailureMessage: null,
  succeededAfterRetry: 0,
  failedRateLimited: 0,
  failedOther: 0,
  skippedByCooldown: 0,
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

// ─────────────────────────────── 429 の再試行（タスクT）

/**
 * @pocket の 429 は **サイト（テナント）単位**で 100 秒あたり 100 回。
 * API キーを増やしても分散しないので、待って出し直す以外に手がない。
 *
 * ただし監査ログはベストエフォートで、業務処理を長く止めてはいけない。
 * Netlify Functions の実行時間（Free で10秒）を超えると業務処理そのものが
 * 失敗するため、**回数と合計待機時間の両方**に上限を置く。
 *
 * 既存の markPocketApiRateLimited / isPocketApiRateLimited とは意図的に
 * つないでいない。createRecord はそもそもあの機構を通らない（実リクエストを
 * 出す）ため二重ブロックは起きず、逆にここから mark すると読み取り系が
 * 100秒間まとめて合成429になってしまう。詳細は完了報告に記載。
 */

const AUDIT_RETRY_BASE_MS = 450;
const AUDIT_RETRY_MAX_WAIT_MS = 14_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 指数バックオフ + フルジッター。同時に詰まった要求が揃って再突入しないように散らす */
export function auditLogBackoffMs(attempt: number, random = Math.random): number {
  const base = AUDIT_RETRY_BASE_MS * 2 ** attempt;
  return Math.round(
    Math.min(AUDIT_RETRY_MAX_WAIT_MS, base) * (0.5 + random()),
  );
}

/** 初回を含む総試行回数。既定3（＝再試行は最大2回） */
function retryMaxAttempts(): number {
  const raw = process.env.AUDIT_LOG_RETRY_MAX_ATTEMPTS?.trim();
  const n = raw ? Number(raw) : 3;
  if (!Number.isFinite(n) || n < 1) return 3;
  return Math.min(10, Math.floor(n));
}

/**
 * 1レコードあたりの合計待機時間の上限。
 * Netlify Free の実行時間は10秒。超えると業務処理ごと落ちるので既定は8秒。
 */
function retryBudgetMs(): number {
  const raw = process.env.AUDIT_LOG_RETRY_BUDGET_MS?.trim();
  const n = raw ? Number(raw) : 8_000;
  if (!Number.isFinite(n) || n < 0) return 8_000;
  return Math.min(30_000, Math.floor(n));
}

/** 再試行を諦めている間の長さ（サーキットブレーカー） */
function retryCooldownMs(): number {
  const raw = process.env.AUDIT_LOG_RETRY_COOLDOWN_MS?.trim();
  const n = raw ? Number(raw) : 30_000;
  if (!Number.isFinite(n) || n < 0) return 30_000;
  return Math.min(300_000, Math.floor(n));
}

/**
 * 一括処理で 429 が続くとき、再試行を繰り返しても待つだけ無駄になる
 * （100秒ウィンドウがサイト単位で埋まっているため）。
 * 一度使い切ったらしばらく再試行を諦め、初回の1回だけ投げて失敗を記録する。
 * 時間が経てば自然に復帰する。
 */
let retryCooldownUntil = 0;

function retryCooldownActive(): boolean {
  return Date.now() < retryCooldownUntil;
}

function openRetryCooldown(target: string): void {
  const ms = retryCooldownMs();
  if (ms <= 0) return;
  retryCooldownUntil = Date.now() + ms;
  console.error(
    `[audit-log] 429 の再試行を使い切りました。次の ${Math.round(ms / 1000)} 秒は再試行しません target=${target}`,
  );
}

/** 運用での手動復帰とテスト用 */
export function resetAuditLogRetryCooldown(): void {
  retryCooldownUntil = 0;
}

type AuditRowWriteOutcome =
  | { ok: true; retried: boolean }
  | {
      ok: false;
      /** rate-limited: 429 で諦めた / cooldown: クールダウン中 / other: 429 以外 */
      reason: "rate-limited" | "cooldown" | "other";
      message: string;
      cause: unknown;
    };

/**
 * 1レコード書き込む。429 のときだけ待って再試行する。
 *
 * 429 以外（列の設定ミス・ペイロードの誤り等）は再送しても直らないので
 * 1回で諦める。throw はせず、結果を呼び出し側へ返す。
 */
async function createRowWithRetry(
  appId: string,
  apiKey: string,
  row: Record<string, unknown>,
  target: string,
): Promise<AuditRowWriteOutcome> {
  const maxAttempts = retryMaxAttempts();
  const budgetMs = retryBudgetMs();
  const startedAt = Date.now();

  for (let attempt = 0; ; attempt++) {
    try {
      await createRecord(appId, row, { apiKey });
      return { ok: true, retried: attempt > 0 };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);

      if (!isPocketHttpRateLimitError(e)) {
        return { ok: false, reason: "other", message, cause: e };
      }

      if (retryCooldownActive()) {
        return { ok: false, reason: "cooldown", message, cause: e };
      }

      if (attempt + 1 >= maxAttempts) {
        openRetryCooldown(target);
        return { ok: false, reason: "rate-limited", message, cause: e };
      }

      // Retry-After があれば自前の計算より優先する
      const wait =
        pocketRetryAfterMsFromError(e) ?? auditLogBackoffMs(attempt);
      if (Date.now() - startedAt + wait > budgetMs) {
        openRetryCooldown(target);
        return { ok: false, reason: "rate-limited", message, cause: e };
      }

      console.warn(
        `[audit-log] 429 のため ${wait}ms 待って再試行します target=${target} attempt=${attempt + 1}/${maxAttempts}`,
      );
      await sleep(wait);
    }
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
      const outcome = await createRowWithRetry(appId, apiKey, row, target);
      if (outcome.ok) {
        written++;
        stats.succeeded++;
        if (outcome.retried) stats.succeededAfterRetry++;
        continue;
      }
      if (outcome.reason === "other") {
        stats.failedOther++;
      } else {
        stats.failedRateLimited++;
        if (outcome.reason === "cooldown") stats.skippedByCooldown++;
      }
      lastError = outcome.message;
      noteFailure(target, lastError, outcome.cause);
    } catch (e) {
      // createRowWithRetry は投げない設計だが、想定外でも業務処理は止めない
      lastError = e instanceof Error ? e.message : String(e);
      stats.failedOther++;
      noteFailure(target, lastError, e);
    }
  }

  if (written === contents.length) return { ok: true, written };
  return {
    ok: false,
    error: `${contents.length} 件中 ${written} 件のみ記録できました: ${lastError}`,
  };
}
