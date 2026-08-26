import "server-only";

import {
  type AtPocketFetchAuth,
  type AtPocketRecordRow,
  fetchRecordsList,
} from "@/lib/atpocket";
import { atPocketRecordIdFromRow } from "@/lib/atpocket-record-id";
import { escapePocketQueryValue } from "@/lib/atpocket-query-escape";

/**
 * アポ取得情報連携で、作成直後のレコード ID を特定する。
 *
 * ■ なぜ要るのか
 * このアプリの POST /records は ID を返さない。Location ヘッダも空、
 * 本文も空で返る（Netlify のログで確認済み: location=null / hasRawBody=false）。
 * 添付の保存先を決めるのに recordId が要るので、一覧から特定するしかない。
 *
 * ■ なぜ「作成前後の差分」なのか
 * お客様名・AP担当者・アポ取得日で絞って一番新しい行を採る、という当て方だと
 * 同姓同名や再登録のときに**既存の別レコードを掴む**。掴んだ先に添付が付き、
 * 共有リンクが上書きされるので、実データを壊す事故になる。
 *
 * 作成の前後で同じ条件の一覧を取り、**増えた ID がちょうど1件のときだけ**
 * それを採用する。既存レコードは必ず作成前の一覧にも入っているので、
 * 掴み違えようがない。増えた件数が 0 件でも 2 件以上でも採用しない
 * （フェイルクローズ。特定できないなら特定しない）。
 *
 * ■ 代償
 * @pocket の呼び出しが登録1回あたり2回増える。新規登録は頻度が低いので許容する。
 */

/** 1回の照合で取る件数。同姓同名がこれを超えることは無い想定 */
const LOOKUP_LIMIT = 1000;

export type ApoRecordSnapshot = {
  /** 一覧に見えたレコード ID */
  recordIds: string[];
  /**
   * 一覧を信用してよいか。
   * 取得に失敗した、または上限に達して取りこぼした可能性があるときは false
   */
  reliable: boolean;
};

/**
 * 増えた ID を1件だけ選ぶ。
 *
 * どちらかの一覧が信用できない、増えていない、2件以上増えた、のいずれでも
 * null を返す。**推測で1件に決めない**こと。
 */
export function pickCreatedApoRecordId(
  before: ApoRecordSnapshot | null,
  after: ApoRecordSnapshot | null,
): string | null {
  if (!before?.reliable || !after?.reliable) return null;

  const seen = new Set(before.recordIds);
  const added = [...new Set(after.recordIds)].filter((id) => !seen.has(id));

  // ちょうど1件のときだけ。0件（まだ見えない）も複数件も採用しない
  return added.length === 1 ? (added[0] ?? null) : null;
}

/**
 * お客様名で絞った一覧のレコード ID を集める。
 *
 * 失敗しても例外にしない。登録そのものを止めないため、
 * 取れなかったことを reliable: false で伝えて呼び出し側に判断させる。
 */
export async function snapshotApoRecordIds(opts: {
  appId: string;
  customerNameFieldId: string;
  customerName: string;
  auth: AtPocketFetchAuth;
}): Promise<ApoRecordSnapshot | null> {
  const fieldId = opts.customerNameFieldId.trim();
  const name = opts.customerName.trim();
  if (!fieldId || !name) return null;

  const query = `${fieldId} = "${escapePocketQueryValue(name)}"`;

  let rows: AtPocketRecordRow[];
  try {
    const res = await fetchRecordsList(
      opts.appId,
      {
        limit: String(LOOKUP_LIMIT),
        page: "1",
        // 行の ID だけ使う。中身は要らないので列は最小限にする
        fields: fieldId,
        query,
      },
      opts.auth,
      {
        operation: "apo-acquisition:登録直後のrecordId照合",
        appEnv: "SALES_DASHBOARD_APO_APP_ID",
      },
      { maxRetries: 0 },
    );
    rows = res.records ?? [];
  } catch (e) {
    // 名前をログに出さない。失敗した事実だけ残す
    console.warn(
      "[apo-acquisition:create] recordId 照合の一覧取得に失敗しました",
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }

  // 上限ちょうどなら取りこぼしの可能性がある。差分の判断には使えない
  if (rows.length >= LOOKUP_LIMIT) {
    console.warn(
      "[apo-acquisition:create] recordId 照合の一覧が上限に達したため使用しません",
      { fetched: rows.length },
    );
    return { recordIds: [], reliable: false };
  }

  const recordIds: string[] = [];
  for (const row of rows) {
    const id = atPocketRecordIdFromRow(row);
    if (id) recordIds.push(id);
  }
  return { recordIds, reliable: true };
}
