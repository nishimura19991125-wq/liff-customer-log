import "server-only";

import type { AtPocketFetchAuth, AtPocketFieldRow } from "@/lib/atpocket";
import {
  apiKeyForCustomerInfoPocket,
  fetchAllRecordsPages,
  fetchAppFieldsTryKeys,
} from "@/lib/atpocket";
import {
  pickRecordValueByFieldAliases,
  resolveConfiguredFieldToSchemaUniqueId,
} from "@/lib/calendar-kojo";
import {
  pocketSelectIncludesLabel,
} from "@/lib/trading-partner-manufacturers";
import {
  nfkcNormalize,
  pocketTableCellToPlainString,
} from "@/lib/staff-construction-availability";

export const PRODUCT_CATALOG_TYPE_SOLAR_PANEL = "太陽光パネル";
export const PRODUCT_CATALOG_TYPE_POWER_CONDITIONER = "パワーコンディショナー";
const STATUS_CURRENT = "現行";

const CACHE_TTL_MS = 10 * 60 * 1000;

export type ProductCatalogFieldIds = {
  manufacturerName: string;
  productType: string;
  status: string;
  modelNumber: string;
};

type CatalogRow = { manufacturer: string; model: string };

type CatalogCacheEntry = {
  expiresAt: number;
  rows: CatalogRow[];
};

const catalogCacheByProductType = new Map<string, CatalogCacheEntry>();
const catalogInflightByProductType = new Map<
  string,
  Promise<CatalogRow[]>
>();

function productCatalogAppId(): string | null {
  return process.env.PRODUCT_CATALOG_APP_ID?.trim() || null;
}

function productCatalogPocketAuth(): AtPocketFetchAuth {
  const k = process.env.PRODUCT_CATALOG_ATPOCKET_API_KEY?.trim();
  return { apiKey: k || apiKeyForCustomerInfoPocket() };
}

function pickFieldUniqueIdByExactCaption(
  fields: AtPocketFieldRow[],
  caption: string,
): string | null {
  const target = caption.normalize("NFKC").trim().toLowerCase();
  for (const f of fields) {
    const cap = f.caption
      ? String(f.caption).normalize("NFKC").trim().toLowerCase()
      : "";
    if (cap && cap === target) {
      const id = f.uniqueId?.trim();
      return id || null;
    }
  }
  return null;
}

function resolveProductCatalogFieldId(
  envKey: string,
  caption: string,
  appFields: AtPocketFieldRow[],
): string | null {
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv) {
    return resolveConfiguredFieldToSchemaUniqueId(fromEnv, appFields);
  }
  return pickFieldUniqueIdByExactCaption(appFields, caption);
}

export function productCatalogFieldIdsFromEnv(): ProductCatalogFieldIds | null {
  const manufacturerName =
    process.env.PRODUCT_CATALOG_MANUFACTURER_NAME_FIELD_ID?.trim();
  const productType =
    process.env.PRODUCT_CATALOG_PRODUCT_TYPE_FIELD_ID?.trim();
  const status = process.env.PRODUCT_CATALOG_STATUS_FIELD_ID?.trim();
  const modelNumber =
    process.env.PRODUCT_CATALOG_MODEL_NUMBER_FIELD_ID?.trim();
  if (!manufacturerName || !productType || !status || !modelNumber) {
    return null;
  }
  return { manufacturerName, productType, status, modelNumber };
}

export function resolveProductCatalogFieldIds(
  appFields: AtPocketFieldRow[],
): ProductCatalogFieldIds | null {
  const manufacturerName = resolveProductCatalogFieldId(
    "PRODUCT_CATALOG_MANUFACTURER_NAME_FIELD_ID",
    "メーカー名",
    appFields,
  );
  const productType = resolveProductCatalogFieldId(
    "PRODUCT_CATALOG_PRODUCT_TYPE_FIELD_ID",
    "商品種別",
    appFields,
  );
  const status = resolveProductCatalogFieldId(
    "PRODUCT_CATALOG_STATUS_FIELD_ID",
    "ステータス",
    appFields,
  );
  const modelNumber = resolveProductCatalogFieldId(
    "PRODUCT_CATALOG_MODEL_NUMBER_FIELD_ID",
    "型番",
    appFields,
  );
  if (!manufacturerName || !productType || !status || !modelNumber) {
    return null;
  }
  return { manufacturerName, productType, status, modelNumber };
}

function pocketApiKeysForProductCatalog(): string[] {
  const dedup = new Set<string>();
  const keys: string[] = [];
  for (const k of [
    process.env.PRODUCT_CATALOG_ATPOCKET_API_KEY?.trim(),
    process.env.CUSTOMER_INFO_ATPOCKET_API_KEY?.trim(),
    process.env.ATPOCKET_API_KEY?.trim(),
  ]) {
    if (k && !dedup.has(k)) {
      dedup.add(k);
      keys.push(k);
    }
  }
  return keys;
}

async function resolveProductCatalogIdsForFetch(
  appId: string,
): Promise<ProductCatalogFieldIds | null> {
  const fromEnv = productCatalogFieldIdsFromEnv();
  if (fromEnv) return fromEnv;

  const appFields = await fetchAppFieldsTryKeys(
    appId,
    pocketApiKeysForProductCatalog(),
  );
  if (!appFields) {
    console.warn(
      "[product-catalog-models] 商品一覧の fields API が失敗しました。PRODUCT_CATALOG_*_FIELD_ID を4つ設定するか、参照権限のある API キーを指定してください。",
    );
    return null;
  }
  return resolveProductCatalogFieldIds(appFields);
}

function readRecordCell(
  rec: Record<string, unknown>,
  fieldId: string,
): unknown {
  return pickRecordValueByFieldAliases(rec, fieldId);
}

function readPlainCell(
  rec: Record<string, unknown>,
  fieldId: string,
): string {
  return nfkcNormalize(
    pocketTableCellToPlainString(readRecordCell(rec, fieldId)),
  );
}

function collectCatalogRows(
  rows: Awaited<ReturnType<typeof fetchAllRecordsPages>>,
  ids: ProductCatalogFieldIds,
  productTypeLabel: string,
  logTag: string,
): CatalogRow[] {
  const out: CatalogRow[] = [];
  let matched = 0;

  for (const row of rows) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const recObj = rec as Record<string, unknown>;

    const typeRaw = readRecordCell(recObj, ids.productType);
    if (!pocketSelectIncludesLabel(typeRaw, productTypeLabel)) {
      continue;
    }
    const statusRaw = readRecordCell(recObj, ids.status);
    if (!pocketSelectIncludesLabel(statusRaw, STATUS_CURRENT)) {
      continue;
    }
    const manufacturer = readPlainCell(recObj, ids.manufacturerName);
    const model = readPlainCell(recObj, ids.modelNumber);
    if (!manufacturer || !model) continue;
    matched += 1;
    out.push({ manufacturer, model });
  }

  console.info(
    `[product-catalog-models:${logTag}] rows=${rows.length} matched=${matched} unique-models=${new Set(out.map((r) => r.model)).size}`,
  );

  return out;
}

async function loadCatalogUncached(
  productTypeLabel: string,
  logTag: string,
): Promise<CatalogRow[]> {
  const appId = productCatalogAppId();
  if (!appId) return [];

  const auth = productCatalogPocketAuth();
  const ids = await resolveProductCatalogIdsForFetch(appId);
  if (!ids) return [];

  const fieldsCsv = [
    ids.manufacturerName,
    ids.productType,
    ids.status,
    ids.modelNumber,
  ].join(",");
  let rows = await fetchAllRecordsPages(appId, fieldsCsv, auth);
  let catalog = collectCatalogRows(rows, ids, productTypeLabel, logTag);

  if (catalog.length <= 1 && rows.length >= 2) {
    const fullRows = await fetchAllRecordsPages(appId, "", auth);
    const retry = collectCatalogRows(fullRows, ids, productTypeLabel, logTag);
    if (retry.length > catalog.length) catalog = retry;
  }

  return catalog;
}

async function loadCatalogByProductType(
  productTypeLabel: string,
  logTag: string,
): Promise<CatalogRow[]> {
  const now = Date.now();
  const cached = catalogCacheByProductType.get(productTypeLabel);
  if (cached && cached.expiresAt > now) {
    return cached.rows;
  }

  const inflight = catalogInflightByProductType.get(productTypeLabel);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const rows = await loadCatalogUncached(productTypeLabel, logTag);
      catalogCacheByProductType.set(productTypeLabel, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        rows,
      });
      return rows;
    } catch (e) {
      console.error(`[product-catalog-models:${logTag}]`, e);
      catalogCacheByProductType.set(productTypeLabel, {
        expiresAt: Date.now() + 60_000,
        rows: [],
      });
      return [];
    } finally {
      catalogInflightByProductType.delete(productTypeLabel);
    }
  })();

  catalogInflightByProductType.set(productTypeLabel, promise);
  return promise;
}

async function fetchModelsForManufacturer(
  manufacturer: string,
  productTypeLabel: string,
  logTag: string,
): Promise<string[] | null> {
  if (!productCatalogAppId()) return null;

  const want = nfkcNormalize(manufacturer);
  if (!want) return [];

  const catalog = await loadCatalogByProductType(productTypeLabel, logTag);
  const models = new Set<string>();
  for (const row of catalog) {
    if (nfkcNormalize(row.manufacturer) !== want) continue;
    models.add(row.model);
  }

  return [...models].sort((a, b) => a.localeCompare(b, "ja"));
}

export async function fetchPanelModelsForManufacturer(
  manufacturer: string,
): Promise<string[] | null> {
  return fetchModelsForManufacturer(
    manufacturer,
    PRODUCT_CATALOG_TYPE_SOLAR_PANEL,
    "panel",
  );
}

export async function fetchPowerConModelsForManufacturer(
  manufacturer: string,
): Promise<string[] | null> {
  return fetchModelsForManufacturer(
    manufacturer,
    PRODUCT_CATALOG_TYPE_POWER_CONDITIONER,
    "power-con",
  );
}

export function mergeCatalogModelOptions(
  options: string[],
  currentValues: string[],
): string[] {
  const merged = new Set(options);
  for (const v of currentValues) {
    const t = nfkcNormalize(v);
    if (t) merged.add(t);
  }
  return [...merged].sort((a, b) => a.localeCompare(b, "ja"));
}
