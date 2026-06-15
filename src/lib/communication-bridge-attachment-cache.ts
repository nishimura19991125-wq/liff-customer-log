import "server-only";

import type { AtPocketFileEntry } from "@/lib/at-pocket-file-field";

type CacheEntry = {
  files: AtPocketFileEntry[];
  expiresAt: number;
};

const store = new Map<string, CacheEntry>();
const TTL_MS = 30 * 60 * 1000;

function entryKey(appId: string, recordId: string): string {
  return `${appId.trim()}\0${recordId.trim()}`;
}

/** 一覧取得時の添付ファイルをキャッシュ（content 付きレコードの再取得を避ける） */
export function cacheCommunicationBridgeAttachmentFiles(
  appId: string,
  recordId: string,
  files: AtPocketFileEntry[],
): void {
  const id = recordId.trim();
  const app = appId.trim();
  if (!app || !id || files.length === 0) return;
  store.set(entryKey(app, id), {
    files: files.map((f) => ({ ...f })),
    expiresAt: Date.now() + TTL_MS,
  });
}

export function getCommunicationBridgeAttachmentFile(
  appId: string,
  recordId: string,
  index: number,
): AtPocketFileEntry | null {
  const key = entryKey(appId, recordId);
  const hit = store.get(key);
  if (!hit || hit.expiresAt < Date.now()) {
    store.delete(key);
    return null;
  }
  const file = hit.files[index];
  return file ?? null;
}
