import "server-only";

import {
  DropboxUploadConflictError,
  listCustomerFolderFileNames,
  uploadCustomerFile,
} from "@/lib/dropbox";
import {
  buildDocumentFileName,
  documentFileNamePrefix,
  jstFileNameStamp,
  nextDocumentSequence,
} from "@/lib/document-upload-name";

/**
 * 書類ファイルを顧客フォルダへ格納する（タスクF）。
 *
 * 連番はフォルダの実在ファイルから決める。同じ分内に2回アップロードすると
 * 衝突し、取り消し機能が無いため上書きは復旧不能な事故になる。
 */

/** 1ファイルあたりの上限。Netlify Functions のボディ上限（約6MB）より小さく取る */
const DEFAULT_UPLOAD_MAX_BYTES = 5_000_000;

export function documentUploadMaxBytes(): number {
  const raw = process.env.DROPBOX_UPLOAD_MAX_BYTES?.trim();
  const n = raw ? Number(raw) : DEFAULT_UPLOAD_MAX_BYTES;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_UPLOAD_MAX_BYTES;
  // Functions のボディ上限を超える値を設定しても意味がないので頭打ちにする
  return Math.min(6_000_000, Math.floor(n));
}

/**
 * フォルダ内ファイル名の短期キャッシュ。
 *
 * クライアントは1ファイルずつ順次送るため、素直に書くと
 * **ファイルごとに list_folder を呼ぶ**ことになりレート上限を圧迫する。
 * 連続アップロードの間だけ一覧を使い回し、格納したファイル名は
 * その場でキャッシュへ足して次の連番に反映する。
 *
 * ⚠ プロセスメモリなので、Netlify が別インスタンスで処理すると
 *    キャッシュに乗らず list_folder が再度走る（正しさは保たれ、呼び出しが増えるだけ）。
 *    さらに mode:add / autorename:false のため、取りこぼしても
 *    上書きは起きず衝突エラーになる。
 */
const LISTING_TTL_MS = 60_000;
const LISTING_MAX_ENTRIES = 200;

type ListingCacheEntry = { names: Set<string>; expiresAt: number };

const folderListingCache = new Map<string, ListingCacheEntry>();

function pruneListingCache(now: number): void {
  for (const [key, entry] of folderListingCache) {
    if (entry.expiresAt <= now) folderListingCache.delete(key);
  }
  while (folderListingCache.size > LISTING_MAX_ENTRIES) {
    const oldest = folderListingCache.keys().next().value;
    if (oldest === undefined) break;
    folderListingCache.delete(oldest);
  }
}

/** テスト・衝突時の作り直し用 */
export function invalidateFolderListingCache(folderPath?: string): void {
  if (folderPath) folderListingCache.delete(folderPath);
  else folderListingCache.clear();
}

async function folderFileNames(folderPath: string): Promise<Set<string>> {
  const now = Date.now();
  const cached = folderListingCache.get(folderPath);
  if (cached && cached.expiresAt > now) return cached.names;

  const names = new Set(await listCustomerFolderFileNames(folderPath));
  pruneListingCache(now);
  folderListingCache.set(folderPath, {
    names,
    expiresAt: now + LISTING_TTL_MS,
  });
  return names;
}

export type StoredDocumentFile = {
  fileName: string;
  filePath: string;
};

/**
 * ファイルを格納し、確定したファイル名を返す。
 *
 * 失敗時は例外を投げる（呼び出し側はステータスを更新しないこと）。
 * 衝突は連番計算の漏れを示すため、握り潰さずサーバログに記録してから投げ直す。
 */
export async function storeCustomerDocumentFile(opts: {
  folderPath: string;
  /** 書類の項目名（@pocket の見出し） */
  caption: string;
  customerName: string;
  /** 検証済みの拡張子（許可リスト通過済み） */
  extension: string;
  bytes: Uint8Array;
  now?: Date;
}): Promise<StoredDocumentFile> {
  const stamp = jstFileNameStamp(opts.now ?? new Date());
  const prefix = documentFileNamePrefix({
    caption: opts.caption,
    customerName: opts.customerName,
    ymd: stamp.ymd,
    hm: stamp.hm,
  });
  if (!prefix) {
    throw new Error("ファイル名を組み立てられませんでした（項目名・お客様名が空）");
  }

  const names = await folderFileNames(opts.folderPath);
  const seq = nextDocumentSequence([...names], prefix);
  const fileName = buildDocumentFileName(prefix, seq, opts.extension);
  const filePath = `${opts.folderPath}/${fileName}`;

  try {
    await uploadCustomerFile(filePath, opts.bytes);
  } catch (e) {
    if (e instanceof DropboxUploadConflictError) {
      // 連番の計算に漏れがある。次回は一覧を取り直す
      invalidateFolderListingCache(opts.folderPath);
      console.error(
        "[customer-document-upload] 既存ファイルと衝突しました。連番の決定に漏れがあります: " +
          `fileName=${fileName} seq=${seq} knownNames=${names.size}`,
        e,
      );
    }
    throw e;
  }

  // 次のファイルの連番に反映させる
  names.add(fileName);
  return { fileName, filePath };
}
