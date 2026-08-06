import "server-only";

import { formatPocketImportKeyWriteError } from "@/lib/atpocket-write-with-import-key";

/**
 * 工事アプリ POST/PUT 失敗時のユーザー向けメッセージ。
 *
 * 既知の設定ミス（取込キー未設定）はそのまま案内を返す。
 * それ以外は @pocket の生メッセージ（appsId・operation・使用した環境変数名を含む）
 * なので、クライアントへは出さず固定文言に置き換える。生の内容は各ルートが
 * console.error に出しているのでサーバログから追える。
 */
const GENERIC =
  "工事アプリへの書き込みに失敗しました。時間をおいて再度お試しください。";

function includeDetail(): boolean {
  const flag = process.env.API_ERROR_DETAIL?.trim();
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}

export function formatConstructionCreateRecordError(detail: string): string {
  const known = formatPocketImportKeyWriteError(detail);
  // 既知パターンに当たれば変換後の案内文がそのまま使える
  if (known !== detail) return known;
  return includeDetail() ? `${GENERIC}（${detail}）` : GENERIC;
}
