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
export const PRODUCT_CATALOG_TYPE_BATTERY = "蓄電池";
const STATUS_CURRENT = "現行";

export type CatalogProductConfig = {
  productTypeLabel: string;
  displayValueEnvKey: string;
  displayValueCaption: string;
  logTag: string;
};

export const CATALOG_CONFIG_PANEL: CatalogProductConfig = {
  productTypeLabel: PRODUCT_CATALOG_TYPE_SOLAR_PANEL,
  displayValueEnvKey: "PRODUCT_CATALOG_MODEL_NUMBER_FIELD_ID",
  displayValueCaption: "型番",
  logTag: "panel",
};

export const CATALOG_CONFIG_POWER_CON: CatalogProductConfig = {
  productTypeLabel: PRODUCT_CATALOG_TYPE_POWER_CONDITIONER,
  displayValueEnvKey: "PRODUCT_CATALOG_MODEL_NUMBER_FIELD_ID",
  displayValueCaption: "型番",
  logTag: "power-con",
};

export const CATALOG_CONFIG_BATTERY: CatalogProductConfig = {
  productTypeLabel: PRODUCT_CATALOG_TYPE_BATTERY,
  displayValueEnvKey: "PRODUCT_CATALOG_OUTPUT_OR_CAPACITY_FIELD_ID",
  displayValueCaption: "出力または容量",
  logTag: "battery",
};

const CACHE_TTL_MS = 10 * 60 * 1000;

export type ProductCatalogFieldIds = {
  manufacturerName: string;
  productType: string;
  status: string;
  displayValue: string;
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

export function productCatalogFieldIdsFromEnv(
  config: CatalogProductConfig,
): ProductCatalogFieldIds | null {
  const manufacturerName =
    process.env.PRODUCT_CATALOG_MANUFACTURER_NAME_FIELD_ID?.trim();
  const productType =
    process.env.PRODUCT_CATALOG_PRODUCT_TYPE_FIELD_ID?.trim();
  const status = process.env.PRODUCT_CATALOG_STATUS_FIELD_ID?.trim();
  const displayValue = process.env[config.displayValueEnvKey]?.trim();
  if (!manufacturerName || !productType || !status || !displayValue) {
    return null;
  }
  return { manufacturerName, productType, status, displayValue };
}

export function resolveProductCatalogFieldIds(
  appFields: AtPocketFieldRow[],
  config: CatalogProductConfig,
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
  const displayValue = resolveProductCatalogFieldId(
    config.displayValueEnvKey,
    config.displayValueCaption,
    appFields,
  );
  if (!manufacturerName || !productType || !status || !displayValue) {
    return null;
  }
  return { manufacturerName, productType, status, displayValue };
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
  config: CatalogProductConfig,
): Promise<ProductCatalogFieldIds | null> {
  const fromEnv = productCatalogFieldIdsFromEnv(config);
  if (fromEnv) return fromEnv;

  const appFields = await fetchAppFieldsTryKeys(
    appId,
    pocketApiKeysForProductCatalog(),
  );
  if (!appFields) {
    console.warn(
      `[product-catalog-models:${config.logTag}] 商品一覧の fields API が失敗しました。PRODUCT_CATALOG_*_FIELD_ID を設定するか、参照権限のある API キーを指定してください。`,
    );
    return null;
  }
  return resolveProductCatalogFieldIds(appFields, config);
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
  config: CatalogProductConfig,
): CatalogRow[] {
  const out: CatalogRow[] = [];
  let matched = 0;

  for (const row of rows) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const recObj = rec as Record<string, unknown>;

    const typeRaw = readRecordCell(recObj, ids.productType);
    if (!pocketSelectIncludesLabel(typeRaw, config.productTypeLabel)) {
      continue;
    }
    const statusRaw = readRecordCell(recObj, ids.status);
    if (!pocketSelectIncludesLabel(statusRaw, STATUS_CURRENT)) {
      continue;
    }
    const manufacturer = readPlainCell(recObj, ids.manufacturerName);
    const model = readPlainCell(recObj, ids.displayValue);
    if (!manufacturer || !model) continue;
    matched += 1;
    out.push({ manufacturer, model });
  }

  console.info(
    `[product-catalog-models:${config.logTag}] rows=${rows.length} matched=${matched} unique-values=${new Set(out.map((r) => r.model)).size}`,
  );

  return out;
}

async function loadCatalogUncached(
  config: CatalogProductConfig,
): Promise<CatalogRow[]> {
  const appId = productCatalogAppId();
  if (!appId) return [];

  const auth = productCatalogPocketAuth();
  const ids = await resolveProductCatalogIdsForFetch(appId, config);
  if (!ids) return [];

  const fieldsCsv = [
    ids.manufacturerName,
    ids.productType,
    ids.status,
    ids.displayValue,
  ].join(",");
  let rows = await fetchAllRecordsPages(appId, fieldsCsv, auth);
  let catalog = collectCatalogRows(rows, ids, config);

  if (catalog.length <= 1 && rows.length >= 2) {
    const fullRows = await fetchAllRecordsPages(appId, "", auth);
    const retry = collectCatalogRows(fullRows, ids, config);
    if (retry.length > catalog.length) catalog = retry;
  }

  return catalog;
}

async function loadCatalogByProductType(
  config: CatalogProductConfig,
): Promise<CatalogRow[]> {
  const cacheKey = config.productTypeLabel;
  const now = Date.now();
  const cached = catalogCacheByProductType.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.rows;
  }

  const inflight = catalogInflightByProductType.get(cacheKey);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const rows = await loadCatalogUncached(config);
      catalogCacheByProductType.set(cacheKey, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        rows,
      });
      return rows;
    } catch (e) {
      console.error(`[product-catalog-models:${config.logTag}]`, e);
      catalogCacheByProductType.set(cacheKey, {
        expiresAt: Date.now() + 60_000,
        rows: [],
      });
      return [];
    } finally {
      catalogInflightByProductType.delete(cacheKey);
    }
  })();

  catalogInflightByProductType.set(cacheKey, promise);
  return promise;
}

async function fetchCatalogValuesForManufacturer(
  manufacturer: string,
  config: CatalogProductConfig,
): Promise<string[] | null> {
  if (!productCatalogAppId()) return null;

  const want = nfkcNormalize(manufacturer);
  if (!want) return [];

  const catalog = await loadCatalogByProductType(config);
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
  return fetchCatalogValuesForManufacturer(manufacturer, CATALOG_CONFIG_PANEL);
}

export async function fetchPowerConModelsForManufacturer(
  manufacturer: string,
): Promise<string[] | null> {
  return fetchCatalogValuesForManufacturer(
    manufacturer,
    CATALOG_CONFIG_POWER_CON,
  );
}

export async function fetchBatteryCapacityOptionsForManufacturer(
  manufacturer: string,
): Promise<string[] | null> {
  return fetchCatalogValuesForManufacturer(manufacturer, CATALOG_CONFIG_BATTERY);
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
