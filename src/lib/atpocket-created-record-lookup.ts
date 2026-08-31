import "server-only";

import {
  type AtPocketFetchAuth,
  type AtPocketRecordRow,
  type AtPocketRequestContext,
  fetchRecordsList,
} from "@/lib/atpocket";
import { atPocketRecordIdFromRow } from "@/lib/atpocket-record-id";
import { escapePocketQueryValue } from "@/lib/atpocket-query-escape";

/**
 * 作成直後のレコード ID を、作成前後の一覧の差分から特定する。
 *
 * ■ なぜ要るのか
 * @pocket の POST /records は ID を返さないことがある（Location ヘッダも
 * 本文も空。Netlify のログで確認済み: location=null / hasRawBody=false）。
 * 作成したレコードに続けて書き込む処理は ID が要るので、一覧から特定する
 * しかない。
 *
 * ■ なぜ「作成前後の差分」なのか
 * お客様名などで絞って一番新しい行を採る、という当て方だと、同姓同名や
 * 再登録のときに**既存の別レコードを掴む**。掴んだ先を更新すると実データを
 * 壊す事故になる。
 *
 * 作成の前後で同じ条件の一覧を取り、**増えた ID がちょうど1件のときだけ**
 * 採用する。既存レコードは必ず作成前の一覧にも入っているので掴み違えない。
 * 0 件でも 2 件以上でも採用しない（フェイルクローズ。特定できないなら
 * 特定しない）。
 *
 * ■ 代償
 * @pocket の呼び出しが**作成前に1回**、作成応答から ID が取れなかった
 * ときだけ**作成後に1回**増える。
 *
 * ■ 使っているところ
 *   - アポ取得情報の登録（apo-record-lookup.ts）
 *   - 工事カレンダー新規登録・施工予定日なし（Aki番号 が無く引き直せない）
 */

/** 1回の照合で取る件数。同名がこれを超えることは無い想定 */
const LOOKUP_LIMIT = 1000;

export type CreatedRecordSnapshot = {
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
export function pickCreatedRecordId(
  before: CreatedRecordSnapshot | null,
  after: CreatedRecordSnapshot | null,
): string | null {
  if (!before?.reliable || !after?.reliable) return null;

  const seen = new Set(before.recordIds);
  const added = [...new Set(after.recordIds)].filter((id) => !seen.has(id));

  // ちょうど1件のときだけ。0件（まだ見えない）も複数件も採用しない
  return added.length === 1 ? (added[0] ?? null) : null;
}

/**
 * ある列がある値と一致する行のレコード ID を集める。
 *
 * 失敗しても例外にしない。登録そのものを止めないため、取れなかったことを
 * reliable: false（または null）で伝えて呼び出し側に判断させる。
 */
export async function snapshotRecordIdsByFieldValue(opts: {
  appId: string;
  /** 絞り込みに使う列の uniqueId */
  fieldId: string;
  /** 絞り込む値。空なら照合しない（null を返す） */
  value: string;
  auth: AtPocketFetchAuth;
  ctx: AtPocketRequestContext;
  /** ログの見出し。呼び出し元ごとに変える */
  logPrefix: string;
}): Promise<CreatedRecordSnapshot | null> {
  const fieldId = opts.fieldId.trim();
  const value = opts.value.trim();
  if (!fieldId || !value) return null;

  const query = `${fieldId} = "${escapePocketQueryValue(value)}"`;

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
      opts.ctx,
      { maxRetries: 0 },
    );
    rows = res.records ?? [];
  } catch (e) {
    // 絞り込んだ値（氏名など）はログに出さない。失敗した事実だけ残す
    console.warn(
      `${opts.logPrefix} recordId 照合の一覧取得に失敗しました`,
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }

  // 上限ちょうどなら取りこぼしの可能性がある。差分の判断には使えない
  if (rows.length >= LOOKUP_LIMIT) {
    console.warn(
      `${opts.logPrefix} recordId 照合の一覧が上限に達したため使用しません`,
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
