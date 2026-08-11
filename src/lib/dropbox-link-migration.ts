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
  DropboxError,
  dropboxConfigured,
  dropboxCustomerRootPath,
  ensureCustomerFolder,
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
 * ensureCustomerFolder を使う。audience=team の明示、既存リンクの
 * resolved_visibility 検証、public 相当なら不採用、はすべてその中にある。
 * ここで新しく Dropbox を呼ぶことはしない。
 *
 * ■ 冪等
 * 対象は「Dropboxリンクが空」の顧客だけ。埋まったものは次回の対象にならない。
 * 進捗を記録する必要がなく、何度実行しても同じ結果になる。
 */

export const DROPBOX_LINK_MIGRATION_DEFAULT_LIMIT = 50;
export const DROPBOX_LINK_MIGRATION_DEFAULT_DELAY_MS = 200;
/** 報告に載せる一覧の上限。全件返すと応答が膨らむ */
const SAMPLE_LIMIT = 50;

export type DropboxLinkMigrationOptions = {
  dryRun: boolean;
  limit: number;
  delayMs: number;
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
  /** 実行時のみ */
  processed?: number;
  succeeded?: number;
  failed?: DropboxLinkMigrationFailure[];
  /** 429 で打ち切ったか */
  stoppedByRateLimit?: boolean;
};

export type DropboxLinkMigrationOutcome =
  | { ok: true; result: DropboxLinkMigrationResult }
  | { ok: false; status: number; error: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  // ── Dropbox のフォルダ一覧（1回だけ） ──────────────
  const folderNames = await listCustomerFolderFileNames(rootPath);

  const match = matchDropboxFoldersByTNumber({
    tNumbers: targets.map((t) => t.tNumber),
    folderNames,
  });

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
  const failed: DropboxLinkMigrationFailure[] = [];
  let stoppedByRateLimit = false;

  for (const item of batch) {
    const recordId = recordIdByTNumber.get(item.tNumber);
    if (!recordId) continue;

    processed += 1;
    try {
      // タスクE と同じ経路。公開範囲の検証もこの中で行われる
      const folder = await ensureCustomerFolder(item.folderName);

      await writePocketRecordWithImportKey({
        appId: cfg.appId,
        recordId,
        // Dropboxリンク と 取込キー だけ。他の項目は載せない
        payload: {
          [linkFieldId]: folder.url,
          [importKeyFieldId]: item.tNumber,
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
        targetTNumber: item.tNumber,
        changes: [
          {
            fieldId: linkFieldId,
            label: linkLabel,
            before: "",
            after: folder.url,
          },
        ],
      });

      succeeded += 1;
    } catch (e) {
      if (isPocketHttpRateLimitError(e) || isDropboxRateLimit(e)) {
        // リトライせずその場で止める
        stoppedByRateLimit = true;
        failed.push({
          tNumber: item.tNumber,
          reason: "利用上限（429）に達したため中断しました",
        });
        break;
      }
      // Dropbox / @pocket の生の本文はクライアントへ返さない
      console.error("[migrate:dropbox-link]", item.tNumber, e);
      failed.push({
        tNumber: item.tNumber,
        reason:
          e instanceof DropboxError
            ? "Dropbox の共有リンクを取得できませんでした（詳細はサーバログ）"
            : "@pocket への書き込みに失敗しました（詳細はサーバログ）",
      });
    }

    if (opts.delayMs > 0) await sleep(opts.delayMs);
  }

  return {
    ok: true,
    result: { ...base, processed, succeeded, failed, stoppedByRateLimit },
  };
}
