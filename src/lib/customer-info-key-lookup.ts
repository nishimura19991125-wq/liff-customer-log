import "server-only";

import {
  customerInfoAppId,
  customerInfoPocketAuth1,
} from "@/lib/customer-info-config";
import {
  customerInfoRecordIdFromRow,
  readCustomerInfoFieldValue,
} from "@/lib/customer-info-record";
import { fetchRecordsList } from "@/lib/atpocket";
import { escapePocketQueryValue } from "@/lib/atpocket-query-escape";
import { startServerTimingLog } from "@/lib/server-timing-log";

const PAGE_LIMIT = 1000;
const DEFAULT_MAX_PAGES = 25;

/**
 * 絞り込みが効いたときの1ページ。キーは一意なので1件しか返らない。
 *
 * ここが満杯で返ってきたら「絞り込みが効いていない」と判断できる
 * （一意キーに 50 件も一致することはない）。
 */
const QUERY_PAGE_LIMIT = 50;

function normalizeConstructionUniqueKey(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function keysMatch(cellValue: string, wantKey: string): boolean {
  const a = normalizeConstructionUniqueKey(cellValue);
  const b = normalizeConstructionUniqueKey(wantKey);
  return Boolean(a && b && a === b);
}

function keyLookupMaxPages(): number {
  const raw = process.env.CUSTOMER_INFO_KEY_LOOKUP_MAX_PAGES?.trim();
  const n = raw ? Number(raw) : DEFAULT_MAX_PAGES;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_PAGES;
  return Math.min(100, Math.floor(n));
}

/**
 * @pocket のフィールド式。他の照合と同じ組み立てにそろえる。
 *   atpocket-record-id.ts                (field-2 = "山田 太郎")
 *   customer-info-construction-link.ts   field-1 = "T00003420"
 *
 * 表記ゆれ（全角空白など）に備えて、生の値と正規化した値の2通りを返す。
 * @pocket に入っている値がどちらの形かは分からないため。同じなら1通り。
 */
function buildKeyEqualsQueries(
  keyFieldSchemaId: string,
  uniqueKey: string,
): string[] {
  const id = keyFieldSchemaId.trim();
  if (!id) return [];
  const raw = uniqueKey.trim();
  const normalized = normalizeConstructionUniqueKey(uniqueKey);

  const out: string[] = [];
  for (const value of [raw, normalized]) {
    if (!value) continue;
    const q = `${id} = "${escapePocketQueryValue(value)}"`;
    if (!out.includes(q)) out.push(q);
  }
  return out;
}

/**
 * お客様情報アプリでキー項目（T番号等）が一致するレコード ID を返す。見つからなければ null。
 *
 * ■ フィールド式で絞る（2026-08 修正）
 * 以前は query に**値そのもの**（"T00003420"）を渡していた。@pocket は
 * これを絞り込みとして解釈せず、**毎回全件を返していた**。計測では
 * 1回の照合で 4リクエスト・2,749件を運び、約2秒かかっていた。
 * 顧客が増えるほど遅くなり、PAGE_LIMIT × maxPages（25,000件）を超えると
 * 照合が「見つからない」を返すようになる。そうなると
 * **同じ顧客のレコードが二重に作られる**。速度ではなく構造の問題だった。
 *
 * ■ 絞り込みが効かなかったときは従来どおり全件走査へ落ちる
 * @pocket がフィールド式を拒否（400 等で例外）した場合と、受け取っても
 * 無視した場合（1ページが満杯で返る）の両方で落ちる。**黙って
 * 「見つからない」を返さない**こと。それが顧客の二重作成に直結する。
 * 落ちたことは警告としてログに残す（遅いまま気づかない状態を作らない）。
 *
 * ■ 走査ループは page=1 から
 * 絞り込みページは limit が違う（50）ので、走査の1ページ目（limit 1000）と
 * 中身が一致しない。page=2 から始めると**先頭 1000 件を読み飛ばす**ことに
 * なり、存在する顧客を「見つからない」と誤判定しうる。
 *
 * ■ 何を計測しているか（A-0）
 *   queryRows   絞り込みページの行数   → QUERY_PAGE_LIMIT なら効いていない
 *   scanPages   走査したページ数       → 1 以上なら絞り込みが効いていない
 *   fallback    走査へ落ちた理由（none / ignored / failed）
 *
 * 出すのは行数・ページ数・上限値と列の識別子だけ。
 * 探している値（T番号・Aki番号）や、見つかったレコードIDは出さない。
 */
export async function findCustomerInfoRecordIdByUniqueKey(
  keyFieldSchemaId: string,
  uniqueKey: string,
): Promise<string | null> {
  const appId = customerInfoAppId();
  if (!appId) return null;

  const want = normalizeConstructionUniqueKey(uniqueKey);
  if (!want) return null;

  const auth = customerInfoPocketAuth1();
  const pocketCtx = {
    operation: "customer-info:キー項目照合(T番号)",
    appEnv: "CUSTOMER_INFO_APP_ID",
  } as const;
  const fieldsCsv = keyFieldSchemaId.trim();
  const maxPages = keyLookupMaxPages();

  const timing = startServerTimingLog("customer-info-key-lookup");
  /** 絞り込みページが返した行数（最後に投げたもの） */
  let queryRows = 0;
  /** 絞り込みを何通り試したか（表記ゆれ対策で最大2） */
  let queryTries = 0;
  /** 走査したページ数と、その合計行数 */
  let scanPages = 0;
  let scanRows = 0;
  /** 走査へ落ちた理由 */
  let fallback: "none" | "ignored" | "failed" = "none";

  const matchIn = (
    rows: NonNullable<Awaited<ReturnType<typeof fetchRecordsList>>["records"]>,
  ): string | null => {
    for (const row of rows) {
      const recordId = customerInfoRecordIdFromRow(row);
      const rec = row.record;
      if (!recordId || !rec || typeof rec !== "object") continue;
      const cell = readCustomerInfoFieldValue(
        rec as Record<string, unknown>,
        fieldsCsv,
      );
      if (keysMatch(cell, want)) return recordId;
    }
    return null;
  };

  /** 1行にまとめて出す。mode は固定文字列だけ */
  const flush = (
    mode: "query-hit" | "query-end" | "scan-hit" | "scan-end" | "scan-cap",
    found: boolean,
  ) => {
    timing.flush({
      mode,
      found,
      fallback,
      keyField: fieldsCsv,
      queryRows,
      queryTries,
      scanPages,
      scanRows,
      queryPageLimit: QUERY_PAGE_LIMIT,
      pageLimit: PAGE_LIMIT,
      maxPages,
    });
  };

  // ── 1) フィールド式で絞る ────────────────────────────────
  for (const query of buildKeyEqualsQueries(fieldsCsv, uniqueKey)) {
    queryTries += 1;
    let rows: NonNullable<
      Awaited<ReturnType<typeof fetchRecordsList>>["records"]
    >;
    try {
      const res = await fetchRecordsList(
        appId,
        {
          limit: String(QUERY_PAGE_LIMIT),
          page: "1",
          fields: fieldsCsv,
          query,
        },
        auth,
        pocketCtx,
      );
      rows = res.records ?? [];
    } catch (e) {
      // 拒否された。値そのものは残さない
      fallback = "failed";
      console.warn(
        "[customer-info-key-lookup] 絞り込みクエリが拒否されたため全件走査へ落ちます（遅くなります）",
        JSON.stringify({
          keyField: fieldsCsv,
          detail: e instanceof Error ? e.message.slice(0, 200) : String(e),
        }),
      );
      break;
    }

    queryRows = rows.length;
    timing.mark("query-page");

    const hit = matchIn(rows);
    if (hit) {
      flush("query-hit", true);
      return hit;
    }

    if (rows.length >= QUERY_PAGE_LIMIT) {
      /**
       * 一意キーに QUERY_PAGE_LIMIT 件も一致することはない。
       * ＝ 絞り込みが無視されている。この結果で「無い」と決めてはいけない
       */
      fallback = "ignored";
      console.warn(
        "[customer-info-key-lookup] 絞り込みクエリが効いていないため全件走査へ落ちます（遅くなります）",
        JSON.stringify({ keyField: fieldsCsv, queryRows, QUERY_PAGE_LIMIT }),
      );
      break;
    }

    // 絞り込みは効いていて、この表記では見つからなかった。次の表記を試す
  }

  if (fallback === "none" && queryTries > 0) {
    // 絞り込みが効いたうえで、どの表記でも見つからなかった＝存在しない
    flush("query-end", false);
    return null;
  }

  // ── 2) フォールバック: 従来どおりの全件走査 ──────────────
  // 絞り込みページは limit が違うので、page=1 から読み直す（読み飛ばさない）
  for (let page = 1; page <= maxPages; page++) {
    const data = await fetchRecordsList(
      appId,
      { limit: String(PAGE_LIMIT), page: String(page), fields: fieldsCsv },
      auth,
      pocketCtx,
    );
    const rows = data.records ?? [];
    scanPages += 1;
    scanRows += rows.length;
    timing.mark("scan-pages");

    const hit = matchIn(rows);
    if (hit) {
      flush("scan-hit", true);
      return hit;
    }
    if (rows.length < PAGE_LIMIT) {
      flush("scan-end", false);
      return null;
    }
  }

  flush("scan-cap", false);
  return null;
}
