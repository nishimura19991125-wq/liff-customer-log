import "server-only";

import {
  fetchAllRecordsPages,
  fetchAppFields,
  isPocketHttpRateLimitError,
  type AtPocketRecordRow,
} from "@/lib/atpocket";
import { atPocketRecordIdFromRow } from "@/lib/atpocket-record-id";
import { writePocketRecordWithImportKey } from "@/lib/atpocket-write-with-import-key";
import { recordAuditLog } from "@/lib/audit-log";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import {
  customerInfoConfigReady,
  customerInfoDashboardListAuths,
  customerInfoImportKeyFieldId,
  customerInfoPocketAuth,
  customerInfoPocketAuthWrite,
} from "@/lib/customer-info-config";
import { resolveCustomerInfoDropboxLinkFieldId } from "@/lib/customer-info-dropbox-link";
import {
  fieldCaptionByUniqueId,
  readCustomerInfoFieldValue,
} from "@/lib/customer-info-record";
import {
  customerFolderSharedLink,
  DropboxError,
  dropboxConfigured,
  dropboxCustomerRootPath,
  listCustomerFolderFileNames,
} from "@/lib/dropbox";
import {
  matchDropboxFoldersByTNumber,
  normalizeTNumber,
} from "@/lib/dropbox-link-migration-match";

/**
 * 既存顧客の Dropbox フォルダ一括紐付け（タスクN）。
 *
 * タスクE の自動作成は新規登録分にしか効かないため、書類移行で作られた
 * 既存フォルダを Dropboxリンク 列へ後から埋める。
 *
 * ■ 触るのは Dropboxリンク 列だけ
 * payload に載せるのは Dropboxリンク と 取込キー（T番号）の2つだけ。
 * 取込キーは @pocket の更新に必須で、値は元のまま変えない。
 *
 * ■ 共有リンクの取得はタスクE の関数をそのまま通す
 * customerFolderSharedLink を使う。中身は ensureCustomerFolder と同じ
 * sharedLinkUrlFor で、audience=team の明示、既存リンクの
 * resolved_visibility 検証、public 相当なら不採用、はすべてその中にある。
 * **速度のためにこの検証を飛ばすことはしない。**
 * 違いは files/create_folder_v2 を呼ばない点だけ（対象は実在するフォルダに
 * 限られるので、作成は必ず conflict になり1往復の無駄になる）。
 *
 * ■ 時間の使い方（Netlify Free は関数の実行上限が10秒固定）
 * 件数ではなく**経過時間**で打ち切る。budgetMs を超えたらその回は終了し、
 * remaining を返して呼び出し側に続きを促す。件数固定だと、1往復の速さが
 * 変わっただけでタイムアウトする。
 *
 * ■ 並列と直列の切り分け
 * Dropbox の共有リンク取得は顧客ごとに独立なので**同時5件**で流す。
 * @pocket への書き込み（お客様情報の更新・更新履歴の作成）は**直列**のまま。
 * 更新履歴の作成が同時に走ると、レート上限に当たったときにどの行が
 * 書けなかったのか追えなくなるため。
 *
 * ■ 冪等
 * 対象は「Dropboxリンクが空」の顧客だけ。埋まったものは次回の対象にならない。
 * 進捗を記録する必要がなく、何度実行しても同じ結果になる。
 */

export const DROPBOX_LINK_MIGRATION_DEFAULT_LIMIT = 50;
export const DROPBOX_LINK_MIGRATION_DEFAULT_DELAY_MS = 100;
/** Netlify Free の実行上限10秒に対する既定。応答を返す余裕を残す */
export const DROPBOX_LINK_MIGRATION_DEFAULT_BUDGET_MS = 8000;
/** Dropbox の共有リンク取得の同時実行数 */
const DROPBOX_CONCURRENCY = 5;
/** これだけ連続で失敗したら中断する。同じ失敗を延々繰り返さないため */
const MAX_CONSECUTIVE_FAILURES = 5;
/** 報告に載せる一覧の上限。全件返すと応答が膨らむ */
const SAMPLE_LIMIT = 50;

export type DropboxLinkMigrationOptions = {
  dryRun: boolean;
  limit: number;
  delayMs: number;
  /** この時間を超えたらその回は打ち切る */
  budgetMs: number;
  /** フォルダ一覧のキャッシュを使わず取り直す */
  refreshFolders?: boolean;
  /** 監査ログの実行者 */
  lineUserId: string;
};

export type DropboxLinkMigrationFailure = {
  tNumber: string;
  reason: string;
};

export type DropboxLinkMigrationResult = {
  dryRun: boolean;
  customersWithoutLink: number;
  foldersInDropbox: number;
  matched: number;
  customersWithoutFolder: number;
  foldersWithoutCustomer: number;
  /** 同じT番号のフォルダが複数あり、機械的に選べなかったもの */
  ambiguous: number;
  samples: Array<{ tNumber: string; folderName: string }>;
  /** フォルダが見つからなかった顧客のT番号（顧客名は出さない） */
  missingFolderTNumbers: string[];
  /** @pocket に対応が無いフォルダ名 */
  orphanFolderNames: string[];
  ambiguousTNumbers: string[];
  /** T番号で始まっていないフォルダ名 */
  unparsableFolderNames: string[];
  /** 対象の抽出とフォルダ一覧にかかった時間（残り時間の目安） */
  setupMs: number;
  /** フォルダ一覧をキャッシュから使ったか */
  foldersFromCache: boolean;
  /** 実行時のみ */
  processed?: number;
  succeeded?: number;
  failed?: DropboxLinkMigrationFailure[];
  /** この回で書き終えられなかった突合済みの件数。0 になるまで繰り返す */
  remaining?: number;
  /** 429 で打ち切ったか */
  stoppedByRateLimit?: boolean;
  /** 連続失敗で打ち切ったか */
  stoppedByFailures?: boolean;
  /** 時間切れで打ち切ったか（正常。続きを呼べばよい） */
  stoppedByBudget?: boolean;
};

export type DropboxLinkMigrationOutcome =
  | { ok: true; result: DropboxLinkMigrationResult }
  | { ok: false; status: number; error: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * フォルダ一覧のプロセスメモリキャッシュ。
 *
 * 準備（対象の抽出＋フォルダ一覧）に毎回3〜4秒かかり、8秒の予算の半分近くを
 * 占めていた。フォルダ一覧は移行の最中に増減しない前提でよいので、
 * 短時間だけ使い回す。
 *
 * **顧客一覧はキャッシュしない。** 「Dropboxリンクが空」の判定が古くなると、
 * 書き込み済みのレコードを再び対象にしてしまい、更新履歴が二重に増える。
 * 冪等性の根拠が「毎回空のものを抽出し直す」ことなので、ここは崩さない。
 *
 * Netlify Free はコンテナが使い回されないと当たらない。当たれば速く、
 * 当たらなくても従来どおり動く、という位置づけ。
 */
const FOLDER_LIST_CACHE_TTL_MS = 10 * 60 * 1000;

let folderListCache: {
  rootPath: string;
  names: string[];
  expiresAt: number;
} | null = null;

/** テストと、フォルダを追加した直後のやり直し用 */
export function resetDropboxLinkMigrationFolderCache(): void {
  folderListCache = null;
}

async function customerFolderNamesCached(
  rootPath: string,
  refresh: boolean,
): Promise<{ names: string[]; fromCache: boolean }> {
  const now = Date.now();
  if (
    !refresh &&
    folderListCache &&
    folderListCache.rootPath === rootPath &&
    folderListCache.expiresAt > now
  ) {
    return { names: folderListCache.names, fromCache: true };
  }

  const names = await listCustomerFolderFileNames(rootPath);
  folderListCache = {
    rootPath,
    names,
    expiresAt: Date.now() + FOLDER_LIST_CACHE_TTL_MS,
  };
  return { names, fromCache: false };
}

/** Dropbox 側の 429。本文はクライアントへ返さない */
function isDropboxRateLimit(e: unknown): boolean {
  if (!(e instanceof DropboxError)) return false;
  return e.message.includes(" 429");
}

type TargetCustomer = {
  recordId: string;
  tNumber: string;
};

/** Dropboxリンクが空で、T番号が入っているレコード */
function collectTargets(
  rows: AtPocketRecordRow[],
  importKeyFieldId: string,
  linkFieldId: string,
): TargetCustomer[] {
  const out: TargetCustomer[] = [];
  for (const row of rows) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const recObj = rec as Record<string, unknown>;

    const link = readCustomerInfoFieldValue(recObj, linkFieldId).trim();
    if (link) continue;

    const tNumber = normalizeTNumber(
      readCustomerInfoFieldValue(recObj, importKeyFieldId),
    );
    if (!tNumber) continue;

    const recordId = atPocketRecordIdFromRow(row);
    if (!recordId) continue;

    out.push({ recordId, tNumber });
  }
  return out;
}

export async function runDropboxLinkMigration(
  opts: DropboxLinkMigrationOptions,
): Promise<DropboxLinkMigrationOutcome> {
  // 予算は関数の実行開始から数える。対象の抽出とフォルダ一覧もこの中に含む
  const startedAt = Date.now();
  const overBudget = () => Date.now() - startedAt >= opts.budgetMs;

  const cfg = customerInfoConfigReady();
  if (!cfg.ok) {
    return { ok: false, status: 503, error: cfg.error };
  }
  if (!dropboxConfigured()) {
    return {
      ok: false,
      status: 503,
      error: "Dropbox の環境変数が未設定です",
    };
  }
  const rootPath = dropboxCustomerRootPath();
  if (!rootPath) {
    return {
      ok: false,
      status: 503,
      error: "DROPBOX_CUSTOMER_ROOT_PATH が未設定です",
    };
  }

  const readAuth = customerInfoPocketAuth();
  const appFields = await fetchAppFields(cfg.appId, readAuth, {
    operation: "migrate:dropbox-link(列定義)",
    appEnv: "CUSTOMER_INFO_APP_ID",
  });

  const linkFieldId = resolveCustomerInfoDropboxLinkFieldId(appFields);
  if (!linkFieldId) {
    return {
      ok: false,
      status: 503,
      error:
        "「Dropboxリンク」列を解決できません。CUSTOMER_INFO_DROPBOX_LINK_FIELD_ID か列見出しを確認してください",
    };
  }

  const importKeyEnv = customerInfoImportKeyFieldId();
  const importKeyFieldId = importKeyEnv
    ? resolveConfiguredFieldToSchemaUniqueId(importKeyEnv, appFields)
    : null;
  if (!importKeyFieldId) {
    return {
      ok: false,
      status: 503,
      error:
        "取込キー（T番号）列を解決できません。CUSTOMER_INFO_CONSTRUCTION_UNIQUE_KEY_FIELD_ID を確認してください",
    };
  }

  // ── 対象の抽出（読むのは2列だけ） ──────────────────
  const listAuths = customerInfoDashboardListAuths();
  const rows = await fetchAllRecordsPages(
    cfg.appId,
    [importKeyFieldId, linkFieldId].join(","),
    listAuths[0],
    null,
    { operation: "migrate:dropbox-link(一覧)", appEnv: "CUSTOMER_INFO_APP_ID" },
    { maxPages: 50, authKeys: listAuths, maxRetries: 1 },
  );
  const targets = collectTargets(rows, importKeyFieldId, linkFieldId);

  // ── Dropbox のフォルダ一覧（1回だけ・短時間キャッシュ） ──
  const folders = await customerFolderNamesCached(
    rootPath,
    opts.refreshFolders === true,
  );
  const folderNames = folders.names;

  const match = matchDropboxFoldersByTNumber({
    tNumbers: targets.map((t) => t.tNumber),
    folderNames,
  });

  const setupMs = Date.now() - startedAt;

  const base: DropboxLinkMigrationResult = {
    dryRun: opts.dryRun,
    customersWithoutLink: targets.length,
    foldersInDropbox: folderNames.length,
    matched: match.matched.length,
    customersWithoutFolder: match.missingFolderTNumbers.length,
    foldersWithoutCustomer: match.orphanFolderNames.length,
    ambiguous: match.ambiguous.length,
    samples: match.matched.slice(0, 10),
    missingFolderTNumbers: match.missingFolderTNumbers.slice(0, SAMPLE_LIMIT),
    orphanFolderNames: match.orphanFolderNames.slice(0, SAMPLE_LIMIT),
    ambiguousTNumbers: match.ambiguous
      .map((a) => a.tNumber)
      .slice(0, SAMPLE_LIMIT),
    unparsableFolderNames: match.unparsableFolderNames.slice(0, SAMPLE_LIMIT),
    setupMs,
    foldersFromCache: folders.fromCache,
  };

  if (opts.dryRun) {
    return { ok: true, result: base };
  }

  // ── 書き込み ────────────────────────────────────
  const recordIdByTNumber = new Map(targets.map((t) => [t.tNumber, t.recordId]));
  const writeAuth = customerInfoPocketAuthWrite();
  const linkLabel = fieldCaptionByUniqueId(appFields, linkFieldId);
  const batch = match.matched.slice(0, Math.max(0, opts.limit));

  let processed = 0;
  let succeeded = 0;
  let consecutiveFailures = 0;
  const failed: DropboxLinkMigrationFailure[] = [];
  let stoppedByRateLimit = false;
  let stoppedByFailures = false;
  let stoppedByBudget = false;

  const noteFailure = (tNumber: string, reason: string): void => {
    failed.push({ tNumber, reason });
    consecutiveFailures += 1;
  };

  /** Dropbox の共有リンクを同時に取る。@pocket はこの後で直列に書く */
  type Resolved = { item: (typeof batch)[number]; url?: string; error?: unknown };

  let cursor = 0;
  while (cursor < batch.length) {
    const budgetExhausted = overBudget();
    // 予算を使い切っていても **1件目は必ず処理する**。
    // 1件も進まないと remaining が減らず、呼び直しても永久に終わらない
    if (cursor > 0 && budgetExhausted) {
      stoppedByBudget = true;
      break;
    }
    // 予算切れの状態で始めるときは1件だけにして、超過を最小に抑える
    const chunkSize = budgetExhausted ? 1 : DROPBOX_CONCURRENCY;
    const chunk = batch.slice(cursor, cursor + chunkSize);
    cursor += chunkSize;
    const resolved: Resolved[] = await Promise.all(
      chunk.map(async (item): Promise<Resolved> => {
        try {
          // タスクE と同じ sharedLinkUrlFor を通る。公開範囲の検証もこの中
          const folder = await customerFolderSharedLink(item.folderName);
          return { item, url: folder.url };
        } catch (error) {
          return { item, error };
        }
      }),
    );

    // Dropbox 側で 429 に当たったら、書き込みに進まずその場で止める
    const rateLimited = resolved.find((r) => isDropboxRateLimit(r.error));
    if (rateLimited) {
      stoppedByRateLimit = true;
      failed.push({
        tNumber: rateLimited.item.tNumber,
        reason: "Dropbox の利用上限（429）に達したため中断しました",
      });
      break;
    }

    // @pocket への書き込みは直列。更新履歴の作成を同時に走らせない
    for (const r of resolved) {
      const recordId = recordIdByTNumber.get(r.item.tNumber);
      if (!recordId) continue;

      processed += 1;

      if (r.error !== undefined || !r.url) {
        // Dropbox の生の本文はクライアントへ返さない
        console.error("[migrate:dropbox-link]", r.item.tNumber, r.error);
        noteFailure(
          r.item.tNumber,
          "Dropbox の共有リンクを取得できませんでした（詳細はサーバログ）",
        );
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          stoppedByFailures = true;
          break;
        }
        continue;
      }

      const url = r.url;
      try {
        await writePocketRecordWithImportKey({
          appId: cfg.appId,
          recordId,
          // Dropboxリンク と 取込キー だけ。他の項目は載せない
          payload: {
            [linkFieldId]: url,
            [importKeyFieldId]: r.item.tNumber,
          },
          importKeyFieldId,
          readAuth,
          writeAuth,
        });

        // 記録に失敗しても書き込みは確定済み（既存のベストエフォート方針と同じ）
        await recordAuditLog({
          lineUserId: opts.lineUserId,
          operation: "update",
          targetAppId: cfg.appId,
          targetRecordId: recordId,
          targetTNumber: r.item.tNumber,
          changes: [
            { fieldId: linkFieldId, label: linkLabel, before: "", after: url },
          ],
        });

        succeeded += 1;
        consecutiveFailures = 0;
      } catch (e) {
        if (isPocketHttpRateLimitError(e)) {
          // リトライせずその場で止める
          stoppedByRateLimit = true;
          failed.push({
            tNumber: r.item.tNumber,
            reason: "@pocket の利用上限（429）に達したため中断しました",
          });
          break;
        }
        console.error("[migrate:dropbox-link]", r.item.tNumber, e);
        noteFailure(
          r.item.tNumber,
          "@pocket への書き込みに失敗しました（詳細はサーバログ）",
        );
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          stoppedByFailures = true;
          break;
        }
      }

      if (opts.delayMs > 0) await sleep(opts.delayMs);
    }

    if (stoppedByRateLimit || stoppedByFailures) break;
  }

  return {
    ok: true,
    result: {
      ...base,
      processed,
      succeeded,
      failed,
      remaining: Math.max(0, match.matched.length - succeeded),
      stoppedByRateLimit,
      stoppedByFailures,
      stoppedByBudget,
    },
  };
}
