import "server-only";

import type { AtPocketFetchAuth, AtPocketFieldRow } from "@/lib/atpocket";
import {
  apiKeyForProductCatalogPocket,
  apiKeyForProductCatalogPocket1,
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
  return { apiKey: apiKeyForProductCatalogPocket() };
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
    apiKeyForProductCatalogPocket(),
    apiKeyForProductCatalogPocket1(),
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

export type BatteryCatalogEntry = {
  manufacturer: string;
  /** 出力または容量（蓄電池容量プルダウンと同一） */
  capacity: string;
  /** 型番（蓄電池品番への自動転記用） */
  modelNumber: string;
};

type BatteryCatalogFieldIds = {
  manufacturerName: string;
  productType: string;
  status: string;
  outputOrCapacity: string;
  modelNumber: string;
};

const BATTERY_ENTRIES_CACHE_KEY = `${PRODUCT_CATALOG_TYPE_BATTERY}:entries`;

function resolveBatteryCatalogFieldIds(
  appFields: AtPocketFieldRow[],
): BatteryCatalogFieldIds | null {
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
  const outputOrCapacity = resolveProductCatalogFieldId(
    "PRODUCT_CATALOG_OUTPUT_OR_CAPACITY_FIELD_ID",
    "出力または容量",
    appFields,
  );
  const modelNumber = resolveProductCatalogFieldId(
    "PRODUCT_CATALOG_MODEL_NUMBER_FIELD_ID",
    "型番",
    appFields,
  );
  if (
    !manufacturerName ||
    !productType ||
    !status ||
    !outputOrCapacity ||
    !modelNumber
  ) {
    return null;
  }
  return {
    manufacturerName,
    productType,
    status,
    outputOrCapacity,
    modelNumber,
  };
}

async function resolveBatteryCatalogFieldIdsForFetch(
  appId: string,
): Promise<BatteryCatalogFieldIds | null> {
  const manufacturerName =
    process.env.PRODUCT_CATALOG_MANUFACTURER_NAME_FIELD_ID?.trim();
  const productType = process.env.PRODUCT_CATALOG_PRODUCT_TYPE_FIELD_ID?.trim();
  const status = process.env.PRODUCT_CATALOG_STATUS_FIELD_ID?.trim();
  const outputOrCapacity =
    process.env.PRODUCT_CATALOG_OUTPUT_OR_CAPACITY_FIELD_ID?.trim();
  const modelNumber = process.env.PRODUCT_CATALOG_MODEL_NUMBER_FIELD_ID?.trim();
  if (
    manufacturerName &&
    productType &&
    status &&
    outputOrCapacity &&
    modelNumber
  ) {
    return {
      manufacturerName,
      productType,
      status,
      outputOrCapacity,
      modelNumber,
    };
  }

  const appFields = await fetchAppFieldsTryKeys(
    appId,
    pocketApiKeysForProductCatalog(),
  );
  if (!appFields) {
    console.warn(
      "[product-catalog-models:battery-entries] 商品一覧の fields API が失敗しました。",
    );
    return null;
  }
  return resolveBatteryCatalogFieldIds(appFields);
}

function collectBatteryCatalogEntries(
  rows: Awaited<ReturnType<typeof fetchAllRecordsPages>>,
  ids: BatteryCatalogFieldIds,
): BatteryCatalogEntry[] {
  const out: BatteryCatalogEntry[] = [];

  for (const row of rows) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const recObj = rec as Record<string, unknown>;

    const typeRaw = readRecordCell(recObj, ids.productType);
    if (!pocketSelectIncludesLabel(typeRaw, PRODUCT_CATALOG_TYPE_BATTERY)) {
      continue;
    }
    const statusRaw = readRecordCell(recObj, ids.status);
    if (!pocketSelectIncludesLabel(statusRaw, STATUS_CURRENT)) {
      continue;
    }

    const manufacturer = readPlainCell(recObj, ids.manufacturerName);
    const capacity = readPlainCell(recObj, ids.outputOrCapacity);
    const modelNumber = readPlainCell(recObj, ids.modelNumber);
    if (!manufacturer || !capacity || !modelNumber) continue;

    out.push({ manufacturer, capacity, modelNumber });
  }

  return out;
}

async function loadBatteryCatalogEntriesUncached(): Promise<BatteryCatalogEntry[]> {
  const appId = productCatalogAppId();
  if (!appId) return [];

  const auth = productCatalogPocketAuth();
  const ids = await resolveBatteryCatalogFieldIdsForFetch(appId);
  if (!ids) return [];

  const fieldsCsv = [
    ids.manufacturerName,
    ids.productType,
    ids.status,
    ids.outputOrCapacity,
    ids.modelNumber,
  ].join(",");

  let rows = await fetchAllRecordsPages(appId, fieldsCsv, auth);
  let entries = collectBatteryCatalogEntries(rows, ids);

  if (entries.length <= 1 && rows.length >= 2) {
    const fullRows = await fetchAllRecordsPages(appId, "", auth);
    const retry = collectBatteryCatalogEntries(fullRows, ids);
    if (retry.length > entries.length) entries = retry;
  }

  return entries;
}

async function loadBatteryCatalogEntries(): Promise<BatteryCatalogEntry[]> {
  const now = Date.now();
  const cached = catalogCacheByProductType.get(BATTERY_ENTRIES_CACHE_KEY);
  if (cached && cached.expiresAt > now) {
    return cached.rows as unknown as BatteryCatalogEntry[];
  }

  const inflight = catalogInflightByProductType.get(BATTERY_ENTRIES_CACHE_KEY);
  if (inflight) {
    return inflight as unknown as Promise<BatteryCatalogEntry[]>;
  }

  const promise = (async () => {
    try {
      const entries = await loadBatteryCatalogEntriesUncached();
      catalogCacheByProductType.set(BATTERY_ENTRIES_CACHE_KEY, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        rows: entries as unknown as CatalogRow[],
      });
      return entries;
    } catch (e) {
      console.error("[product-catalog-models:battery-entries]", e);
      catalogCacheByProductType.set(BATTERY_ENTRIES_CACHE_KEY, {
        expiresAt: Date.now() + 60_000,
        rows: [],
      });
      return [];
    } finally {
      catalogInflightByProductType.delete(BATTERY_ENTRIES_CACHE_KEY);
    }
  })();

  catalogInflightByProductType.set(BATTERY_ENTRIES_CACHE_KEY, promise as unknown as Promise<CatalogRow[]>);
  return promise;
}

/** メーカー・蓄電池容量（出力または容量）に一致する商品一覧レコードの型番 */
export async function lookupBatteryModelNumberByCapacity(
  manufacturer: string,
  capacityValue: string,
): Promise<string | null> {
  if (!productCatalogAppId()) return null;

  const wantM = nfkcNormalize(manufacturer);
  const wantC = nfkcNormalize(capacityValue);
  if (!wantM || !wantC) return null;

  const entries = await loadBatteryCatalogEntries();
  for (const entry of entries) {
    if (nfkcNormalize(entry.manufacturer) !== wantM) continue;
    if (nfkcNormalize(entry.capacity) !== wantC) continue;
    return entry.modelNumber;
  }
  return null;
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
