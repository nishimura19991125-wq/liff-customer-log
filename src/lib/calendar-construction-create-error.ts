import { formatPocketImportKeyWriteError } from "@/lib/atpocket-write-with-import-key";

/** 工事アプリ POST /records 失敗時のユーザー向けメッセージ */
export function formatConstructionCreateRecordError(detail: string): string {
  return formatPocketImportKeyWriteError(detail);
}
