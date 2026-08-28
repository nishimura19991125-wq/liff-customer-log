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
import { startServerTimingLog } from "@/lib/server-timing-log";

const PAGE_LIMIT = 1000;
const DEFAULT_MAX_PAGES = 25;

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
 * お客様情報アプリでキー項目（T番号等）が一致するレコード ID を返す。見つからなければ null。
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
  /** query 付きの1ページ目が返した行数 */
  let queryRows = 0;
  /** query 無しで引いたページ数と、その合計行数 */
  let scanPages = 0;
  let scanRows = 0;

  const scanPage = async (
    page: number,
    query?: string,
  ): Promise<string | null> => {
    const data = await fetchRecordsList(
      appId,
      {
        limit: String(PAGE_LIMIT),
        page: String(page),
        fields: fieldsCsv,
        ...(query ? { query } : {}),
      },
      auth,
      pocketCtx,
    );
    const rows = data.records ?? [];
    if (query) {
      queryRows = rows.length;
    } else {
      scanPages += 1;
      scanRows += rows.length;
    }
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
    return rows.length < PAGE_LIMIT ? "end" : null;
  };

  /** 1行にまとめて出す。mode は固定文字列だけ */
  const flush = (
    mode: "query-hit" | "query-end" | "scan-hit" | "scan-end" | "scan-cap",
    found: boolean,
  ) => {
    timing.flush({
      mode,
      found,
      keyField: fieldsCsv,
      queryRows,
      scanPages,
      scanRows,
      pageLimit: PAGE_LIMIT,
      maxPages,
    });
  };

  const qHit = await scanPage(1, uniqueKey);
  timing.mark("query-page");
  if (typeof qHit === "string") {
    if (qHit === "end") {
      flush("query-end", false);
      return null;
    }
    flush("query-hit", true);
    return qHit;
  }

  for (let page = 1; page <= maxPages; page++) {
    const hit = await scanPage(page);
    timing.mark("scan-pages");
    if (typeof hit === "string") {
      if (hit === "end") {
        flush("scan-end", false);
        return null;
      }
      flush("scan-hit", true);
      return hit;
    }
  }

  flush("scan-cap", false);

  return null;
}
