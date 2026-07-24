import "server-only";

import {
  fetchAppFieldsTryKeys,
  fetchRecordsList,
  readAuthsForApp,
} from "@/lib/atpocket";
import {
  customerInfoAppId,
  customerInfoConfigReady,
  customerInfoImportKeyFieldId,
  customerInfoListAuths,
} from "@/lib/customer-info-config";
import {
  recordIsCustomerStatusCancelled,
  resolveCrmCustomerStatusFieldId,
} from "@/lib/customer-crm-status";
import { readCustomerInfoFieldValue } from "@/lib/customer-info-record";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";

const PAGE_LIMIT = 1000;
const DEFAULT_MAX_PAGES = 25;
const DEFAULT_CACHE_TTL_MS = 180_000;
const DEFAULT_PAGE_DELAY_MS = 300;

type CacheEntry = { expiresAt: number; tNumbers: Set<string> };

let cancelledTNumberCache: CacheEntry | null = null;
let cancelledTNumberInflight: Promise<Set<string>> | null = null;

function cacheTtlMs(): number {
  const raw = process.env.CUSTOMER_CANCELLED_T_CACHE_TTL_MS?.trim();
  const n = raw ? Number(raw) : DEFAULT_CACHE_TTL_MS;
  if (!Number.isFinite(n) || n < 0) return DEFAULT_CACHE_TTL_MS;
  return Math.min(600_000, Math.floor(n));
}

function maxPages(): number {
  const raw = process.env.CUSTOMER_CANCELLED_T_MAX_PAGES?.trim();
  const n = raw ? Number(raw) : DEFAULT_MAX_PAGES;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_PAGES;
  return Math.min(50, Math.floor(n));
}

function pageDelayMs(): number {
  const raw = process.env.CUSTOMER_CANCELLED_T_PAGE_DELAY_MS?.trim();
  const n = raw ? Number(raw) : DEFAULT_PAGE_DELAY_MS;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(2000, Math.floor(n));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCancelledCustomerTNumbersFromPocket(): Promise<Set<string>> {
  const cfg = customerInfoConfigReady();
  if (!cfg.ok) return new Set();

  const appId = customerInfoAppId();
  const tNumberEnv = customerInfoImportKeyFieldId();
  if (!appId || !tNumberEnv) return new Set();

  const readAuths = readAuthsForApp("CUSTOMER_INFO");
  const listAuths = customerInfoListAuths();
  const appFields =
    (await fetchAppFieldsTryKeys(
      appId,
      readAuths.map((a) => a.apiKey ?? ""),
    )) ?? [];
  if (appFields.length === 0) return new Set();

  const statusFieldId = resolveCrmCustomerStatusFieldId(appFields);
  const tNumberFieldId = resolveConfiguredFieldToSchemaUniqueId(
    tNumberEnv,
    appFields,
  );
  if (!statusFieldId || !tNumberFieldId) {
    console.warn(
      "[customer-cancelled-t] 顧客ステータスまたは T番号 列を解決できません",
    );
    return new Set();
  }

  const fieldsCsv = [statusFieldId, tNumberFieldId].join(",");
  const ctx = {
    operation: "customer-info:キャンセルT番号",
    appEnv: "CUSTOMER_INFO_APP_ID",
  } as const;
  const listOptions = {
    maxRetries: 1,
    ...(listAuths.length >= 2 ? { authKeys: listAuths } : {}),
  };

  const out = new Set<string>();
  const delay = pageDelayMs();
  const pages = maxPages();

  for (let page = 1; page <= pages; page++) {
    if (page > 1 && delay > 0) await sleep(delay);
    const data = await fetchRecordsList(
      appId,
      {
        limit: String(PAGE_LIMIT),
        page: String(page),
        fields: fieldsCsv,
      },
      listAuths[0],
      ctx,
      {
        ...listOptions,
        authStartIndex: listAuths.length >= 2 ? page - 1 : undefined,
      },
    );
    const rows = data.records ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const rec = row.record;
      if (!rec || typeof rec !== "object") continue;
      const recObj = rec as Record<string, unknown>;
      if (!recordIsCustomerStatusCancelled(recObj, statusFieldId)) continue;
      const t = normApClStaffName(
        readCustomerInfoFieldValue(recObj, tNumberFieldId),
      );
      if (t) out.add(t);
    }

    if (rows.length < PAGE_LIMIT) break;
  }

  return out;
}

/** 顧客ステータスがキャンセルの T番号集合（短時間キャッシュ） */
export async function fetchCancelledCustomerTNumbersCached(): Promise<
  Set<string>
> {
  const ttl = cacheTtlMs();
  const now = Date.now();
  if (cancelledTNumberCache && cancelledTNumberCache.expiresAt > now) {
    return new Set(cancelledTNumberCache.tNumbers);
  }
  if (cancelledTNumberInflight) {
    return cancelledTNumberInflight.then((s) => new Set(s));
  }

  cancelledTNumberInflight = (async () => {
    try {
      const tNumbers = await fetchCancelledCustomerTNumbersFromPocket();
      cancelledTNumberCache = {
        expiresAt: Date.now() + ttl,
        tNumbers,
      };
      return tNumbers;
    } finally {
      cancelledTNumberInflight = null;
    }
  })();

  return cancelledTNumberInflight.then((s) => new Set(s));
}

/** 指定 T番号のお客様情報がキャンセルか（未設定・未取得時は false） */
export async function isCustomerTNumberCancelled(
  tNumber: string,
): Promise<boolean> {
  const normT = normApClStaffName(tNumber);
  if (!normT) return false;
  const cancelled = await fetchCancelledCustomerTNumbersCached();
  return cancelled.has(normT);
}
