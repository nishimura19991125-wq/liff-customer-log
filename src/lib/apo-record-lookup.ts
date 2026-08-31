import "server-only";

import type { AtPocketFetchAuth } from "@/lib/atpocket";
import {
  type CreatedRecordSnapshot,
  pickCreatedRecordId,
  snapshotRecordIdsByFieldValue,
} from "@/lib/atpocket-created-record-lookup";

/**
 * アポ取得情報連携で、作成直後のレコード ID を特定する。
 *
 * 中身は共通の「作成前後の差分」（atpocket-created-record-lookup.ts）。
 * 同じ問題が工事カレンダーの新規登録でも起きたため、そちらへ移した。
 * なぜ差分で採るのか・なぜ推測しないのかは移した先に書いてある。
 *
 * ここに残すのは、アポ取得としての呼び出し方（どの列で絞るか・
 * どのログ見出しを使うか）だけ。
 */

const LOG_PREFIX = "[apo-acquisition:create]";

export type ApoRecordSnapshot = CreatedRecordSnapshot;

export { pickCreatedRecordId as pickCreatedApoRecordId };

/** お客様名で絞った一覧のレコード ID を集める */
export async function snapshotApoRecordIds(opts: {
  appId: string;
  customerNameFieldId: string;
  customerName: string;
  auth: AtPocketFetchAuth;
}): Promise<ApoRecordSnapshot | null> {
  return snapshotRecordIdsByFieldValue({
    appId: opts.appId,
    fieldId: opts.customerNameFieldId,
    value: opts.customerName,
    auth: opts.auth,
    ctx: {
      operation: "apo-acquisition:登録直後のrecordId照合",
      appEnv: "SALES_DASHBOARD_APO_APP_ID",
    },
    logPrefix: LOG_PREFIX,
  });
}
