import "server-only";

import { randomUUID } from "node:crypto";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import type { AuditLogFieldChange } from "@/lib/audit-log-changes";
import {
  pocketFieldUniqueIdByCaption,
  resolveConfiguredFieldToSchemaUniqueId,
} from "@/lib/calendar-kojo";
import { resolveCustomerInfoFormFieldId } from "@/lib/customer-info-form/resolve-fields";
import {
  dropboxConfigured,
  dropboxCustomerRootPath,
  ensureCustomerFolder,
  renameCustomerFolder,
} from "@/lib/dropbox";
import {
  buildCustomerFolderName,
  joinDropboxPath,
} from "@/lib/dropbox-folder-name";

/**
 * お客様情報アプリの「Dropboxリンク」列への書き込みと、
 * 顧客フォルダの作成・リネームをまとめる。
 *
 * Dropbox 側の失敗で**顧客登録・顧客情報更新を止めない**のがこのモジュールの責務。
 * 例外はここで握り、相関ID付きでサーバログに出し、呼び出し側へは
 * 「警告文言」か null だけを返す。Dropbox のエラー本文（内部パス構造を含む）は
 * クライアントへ渡さない。
 */

/** E-5 の画面表示に使う固定文言。内部情報を含めない */
export const DROPBOX_FOLDER_WARNING =
  "Dropboxフォルダの作成に失敗しました。DX事業部へ連絡してください。";

const LINK_FIELD_CAPTION = "Dropboxリンク";

/**
 * 「Dropboxリンク」列の uniqueId を解決する。
 * 環境変数が未設定なら見出しの完全一致で解決する（CUSTOMER_INFO_FIELD_* と同じ方式）。
 */
export function resolveCustomerInfoDropboxLinkFieldId(
  appFields: AtPocketFieldRow[],
): string | null {
  const fromEnv = process.env.CUSTOMER_INFO_DROPBOX_LINK_FIELD_ID?.trim();
  if (fromEnv) {
    return resolveConfiguredFieldToSchemaUniqueId(fromEnv, appFields);
  }
  return pocketFieldUniqueIdByCaption(appFields, LINK_FIELD_CAPTION);
}

function newCorrelationId(): string {
  return randomUUID().slice(0, 8);
}

/** Dropbox の生メッセージはここまで。クライアントへは渡らない */
function logDropboxFailure(
  scope: string,
  correlationId: string,
  detail: unknown,
): void {
  console.error(
    `[${scope}] correlationId=${correlationId} Dropbox 連携に失敗しました`,
    detail,
  );
}

export type EnsureCustomerFolderLinkResult = {
  /** 取得できた共有リンク（失敗時は null） */
  url: string | null;
  /** 画面に出す警告（成功・スキップ時は null） */
  warning: string | null;
};

/**
 * 顧客フォルダを用意して共有リンクを返す（E-2）。
 *
 * - Dropbox 未設定なら何もしない（警告も出さない）
 * - T番号・お客様名が空ならフォルダを作らずサーバログに記録する
 * - 既存フォルダがあれば既存の共有リンクを返す（ensureCustomerFolder 側で吸収）
 * - 失敗しても例外を投げない。呼び出し側の保存処理を止めないため
 */
export async function ensureCustomerFolderLink(opts: {
  tNumber: string;
  customerName: string;
  scope: string;
}): Promise<EnsureCustomerFolderLinkResult> {
  if (!dropboxConfigured()) {
    return { url: null, warning: null };
  }

  const folderName = buildCustomerFolderName(opts.tNumber, opts.customerName);
  if (!folderName) {
    // 顧客名（または T番号）が空。フォルダは作らず記録だけ残す
    console.error(
      `[${opts.scope}] Dropbox フォルダ名を組み立てられないため作成をスキップしました`,
      {
        hasTNumber: Boolean(opts.tNumber?.trim()),
        hasCustomerName: Boolean(opts.customerName?.trim()),
      },
    );
    return { url: null, warning: DROPBOX_FOLDER_WARNING };
  }

  try {
    const { url } = await ensureCustomerFolder(folderName);
    return { url, warning: null };
  } catch (e) {
    logDropboxFailure(opts.scope, newCorrelationId(), e);
    return { url: null, warning: DROPBOX_FOLDER_WARNING };
  }
}

/**
 * 顧客名の変更に追随してフォルダをリネームし、新しい共有リンクを返す（E-4）。
 *
 * 失敗しても例外を投げない（顧客情報の更新は止めない）。
 * リネームできなかったときは null を返し、リンク列は触らない。
 */
export async function renameCustomerFolderLink(opts: {
  tNumber: string;
  oldCustomerName: string;
  newCustomerName: string;
  scope: string;
}): Promise<string | null> {
  if (!dropboxConfigured()) return null;

  const rootPath = dropboxCustomerRootPath();
  if (!rootPath) return null;

  const oldName = buildCustomerFolderName(opts.tNumber, opts.oldCustomerName);
  const newName = buildCustomerFolderName(opts.tNumber, opts.newCustomerName);
  if (!oldName || !newName) {
    console.error(
      `[${opts.scope}] Dropbox フォルダ名を組み立てられないためリネームをスキップしました`,
      {
        hasTNumber: Boolean(opts.tNumber?.trim()),
        hasOldName: Boolean(opts.oldCustomerName?.trim()),
        hasNewName: Boolean(opts.newCustomerName?.trim()),
      },
    );
    return null;
  }
  if (oldName === newName) return null;

  try {
    return await renameCustomerFolder(
      joinDropboxPath(rootPath, oldName),
      joinDropboxPath(rootPath, newName),
    );
  } catch (e) {
    logDropboxFailure(opts.scope, newCorrelationId(), e);
    return null;
  }
}

/**
 * 顧客名の変更を検知して Dropbox フォルダをリネームし、
 * 新しい共有リンクを **同じ payload に載せる**（E-4）。
 *
 * 差分は呼び出し側が監査ログ用に計算済みの `changes` をそのまま使う。
 * ここで差分計算を書き直さない（タスクA の computeAuditChanges が
 * NFKC・空白・全半角の揺れを既に吸収しているため、表記ゆれだけの
 * 「変更」で無駄なリネームを起こさない）。
 *
 * payload を破壊的に更新する。リンク列に値が入れば、監査ログには
 * 既存の仕組みで「Dropboxリンク」列の変更としてそのまま載る。
 *
 * 失敗しても例外を投げない（顧客情報の更新は止めない）。
 */
export async function applyDropboxFolderRenameToPayload(opts: {
  changes: readonly AuditLogFieldChange[];
  payload: Record<string, unknown>;
  appFields: AtPocketFieldRow[];
  tNumber: string;
  scope: string;
}): Promise<void> {
  if (!dropboxConfigured()) return;

  const tNumber = opts.tNumber.trim();
  if (!tNumber) {
    // T番号が無いとフォルダ名を特定できない。更新は続行する
    console.error(
      `[${opts.scope}] T番号を取得できないため Dropbox フォルダのリネームをスキップしました`,
    );
    return;
  }

  const nameFieldId = resolveCustomerInfoFormFieldId(
    "customerName",
    "お客様名",
    opts.appFields,
  );
  if (!nameFieldId) return;

  const nameChange = opts.changes.find((c) => c.fieldId === nameFieldId);
  if (!nameChange) return;

  const oldName = nameChange.before.trim();
  const newName = nameChange.after.trim();
  // 新規入力（更新前が空）はリネーム対象にしない。旧フォルダが存在しないため
  if (!oldName || !newName) return;

  const url = await renameCustomerFolderLink({
    tNumber,
    oldCustomerName: oldName,
    newCustomerName: newName,
    scope: opts.scope,
  });
  if (!url) return;

  const linkFieldId = resolveCustomerInfoDropboxLinkFieldId(opts.appFields);
  if (!linkFieldId) {
    console.error(
      `[${opts.scope}] 「Dropboxリンク」列を解決できないためリンクを更新できません。CUSTOMER_INFO_DROPBOX_LINK_FIELD_ID か列見出しを確認してください`,
    );
    return;
  }
  opts.payload[linkFieldId] = url;
}
