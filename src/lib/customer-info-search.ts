import "server-only";

import {
  customerInfoAppId,
  customerInfoNameFieldId,
  customerInfoPocketAuth1,
  customerInfoSubtitleFieldId,
} from "@/lib/customer-info-config";
import {
  customerInfoRecordIdFromRow,
  normalizeCustomerInfoSearchText,
  readCustomerInfoFieldValue,
} from "@/lib/customer-info-record";
import { fetchRecordsList } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import { fetchAppFields } from "@/lib/atpocket";

export type CustomerInfoSearchHit = {
  recordId: string;
  customerName: string;
  subtitle: string;
};

const PAGE_LIMIT = 1000;
const DEFAULT_MAX_PAGES = 15;
const DEFAULT_MAX_RESULTS = 40;

function searchMaxPages(): number {
  const raw = process.env.CUSTOMER_INFO_SEARCH_MAX_PAGES?.trim();
  const n = raw ? Number(raw) : DEFAULT_MAX_PAGES;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_PAGES;
  return Math.min(50, Math.floor(n));
}

function searchMaxResults(): number {
  const raw = process.env.CUSTOMER_INFO_SEARCH_MAX_RESULTS?.trim();
  const n = raw ? Number(raw) : DEFAULT_MAX_RESULTS;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_RESULTS;
  return Math.min(100, Math.floor(n));
}

/**
 * お客様名の部分一致で検索（@pocket 一覧をページングしサーバー側で絞り込み）。
 */
export async function searchCustomerInfoRecordsByName(
  queryRaw: string,
): Promise<CustomerInfoSearchHit[]> {
  const appId = customerInfoAppId();
  const nameFieldEnv = customerInfoNameFieldId();
  if (!appId || !nameFieldEnv) {
    throw new Error("お客様情報アプリの設定が不足しています");
  }

  const q = normalizeCustomerInfoSearchText(queryRaw);
  if (!q) return [];

  const auth = customerInfoPocketAuth1();
  const pocketCtx = {
    operation: "customer-info:お客様名検索",
    appEnv: "CUSTOMER_INFO_APP_ID",
  } as const;
  const fields = await fetchAppFields(appId, auth, pocketCtx);
  const nameField = resolveConfiguredFieldToSchemaUniqueId(
    nameFieldEnv,
    fields,
  );
  if (!nameField) {
    throw new Error(
      `お客様名フィールド「${nameFieldEnv}」がアプリ定義と一致しません`,
    );
  }

  const subtitleEnv = customerInfoSubtitleFieldId();
  let subtitleField: string | null = null;
  if (subtitleEnv) {
    subtitleField = resolveConfiguredFieldToSchemaUniqueId(
      subtitleEnv,
      fields,
    );
  }

  const fieldsCsv = subtitleField
    ? [nameField, subtitleField].join(",")
    : nameField;

  const maxPages = searchMaxPages();
  const maxResults = searchMaxResults();
  const hits: CustomerInfoSearchHit[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const data = await fetchRecordsList(
      appId,
      {
        limit: String(PAGE_LIMIT),
        page: String(page),
        fields: fieldsCsv,
      },
      auth,
      pocketCtx,
    );
    const rows = data.records ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const recordId = customerInfoRecordIdFromRow(row);
      const rec = row.record;
      if (!recordId || !rec || typeof rec !== "object") continue;

      const recObj = rec as Record<string, unknown>;
      const name = readCustomerInfoFieldValue(recObj, nameField);
      if (!name) continue;

      const normalizedName = normalizeCustomerInfoSearchText(name);
      if (!normalizedName.includes(q)) continue;

      const subtitle = subtitleField
        ? readCustomerInfoFieldValue(recObj, subtitleField)
        : "";

      hits.push({
        recordId,
        customerName: name,
        subtitle,
      });

      if (hits.length >= maxResults) return hits;
    }

    if (rows.length < PAGE_LIMIT) break;
  }

  hits.sort((a, b) =>
    a.customerName.localeCompare(b.customerName, "ja"),
  );
  return hits;
}
