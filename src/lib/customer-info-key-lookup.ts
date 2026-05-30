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

  const qHit = await scanPage(1, uniqueKey);
  if (typeof qHit === "string") {
    if (qHit === "end") return null;
    return qHit;
  }

  for (let page = 1; page <= maxPages; page++) {
    const hit = await scanPage(page);
    if (typeof hit === "string") {
      if (hit === "end") return null;
      return hit;
    }
  }

  return null;
}
