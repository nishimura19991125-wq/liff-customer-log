import "server-only";

import type { AtPocketFetchAuth, AtPocketFieldRow } from "@/lib/atpocket";
import {
  apiKeyForCustomerInfoPocket,
  fetchAllRecordsPages,
  fetchAppFields,
} from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import { coerceCustomerInfoDisplayString } from "@/lib/customer-info-record";

const COMPANY_TYPE_MANUFACTURER = "メーカー";
const TRADE_STATUS_ACTIVE = "取引中";

const CACHE_TTL_MS = 10 * 60 * 1000;

type ManufacturerCache = {
  expiresAt: number;
  options: string[] | null;
};

let cache: ManufacturerCache | null = null;
let inflight: Promise<string[] | null> | null = null;

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

function tradingPartnerAppId(): string | null {
  return process.env.TRADING_PARTNER_APP_ID?.trim() || null;
}

function tradingPartnerPocketAuth(): AtPocketFetchAuth {
  const k = process.env.TRADING_PARTNER_ATPOCKET_API_KEY?.trim();
  return { apiKey: k || apiKeyForCustomerInfoPocket() };
}

function pickFieldUniqueIdByExactCaption(
  fields: AtPocketFieldRow[],
  caption: string,
): string | null {
  const target = nfkc(caption).toLowerCase();
  for (const f of fields) {
    const cap = f.caption ? nfkc(String(f.caption)).toLowerCase() : "";
    if (cap && cap === target) {
      const id = f.uniqueId?.trim();
      return id || null;
    }
  }
  return null;
}

function resolveTradingPartnerFieldId(
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

export type TradingPartnerFieldIds = {
  companyType: string;
  tradeStatus: string;
  companyName: string;
};

export function resolveTradingPartnerFieldIds(
  appFields: AtPocketFieldRow[],
): TradingPartnerFieldIds | null {
  const companyType = resolveTradingPartnerFieldId(
    "TRADING_PARTNER_COMPANY_TYPE_FIELD_ID",
    "会社種別",
    appFields,
  );
  const tradeStatus = resolveTradingPartnerFieldId(
    "TRADING_PARTNER_TRADE_STATUS_FIELD_ID",
    "取引状況",
    appFields,
  );
  const companyName = resolveTradingPartnerFieldId(
    "TRADING_PARTNER_COMPANY_NAME_FIELD_ID",
    "取引会社名",
    appFields,
  );
  if (!companyType || !tradeStatus || !companyName) return null;
  return { companyType, tradeStatus, companyName };
}

function readSelectCell(
  rec: Record<string, unknown>,
  fieldId: string,
): string {
  return nfkc(coerceCustomerInfoDisplayString(rec[fieldId]));
}

async function fetchManufacturerOptionsUncached(): Promise<string[] | null> {
  const appId = tradingPartnerAppId();
  if (!appId) return null;

  const auth = tradingPartnerPocketAuth();
  const appFields = await fetchAppFields(appId, auth);
  const ids = resolveTradingPartnerFieldIds(appFields);
  if (!ids) {
    console.warn(
      "[trading-partner-manufacturers] 取引先会社一覧の列（会社種別・取引状況・取引会社名）を解決できません",
    );
    return [];
  }

  const fieldsCsv = [ids.companyType, ids.tradeStatus, ids.companyName].join(
    ",",
  );
  const rows = await fetchAllRecordsPages(appId, fieldsCsv, auth);
  const names = new Set<string>();

  for (const row of rows) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const recObj = rec as Record<string, unknown>;
    if (readSelectCell(recObj, ids.companyType) !== COMPANY_TYPE_MANUFACTURER) {
      continue;
    }
    if (readSelectCell(recObj, ids.tradeStatus) !== TRADE_STATUS_ACTIVE) {
      continue;
    }
    const name = readSelectCell(recObj, ids.companyName);
    if (name) names.add(name);
  }

  return [...names].sort((a, b) => a.localeCompare(b, "ja"));
}

/** 取引先会社一覧からメーカー（取引中）の会社名リスト。未設定時は null */
export async function fetchTradingPartnerManufacturerOptions(): Promise<
  string[] | null
> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.options;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const options = await fetchManufacturerOptionsUncached();
      cache = { expiresAt: Date.now() + CACHE_TTL_MS, options };
      return options;
    } catch (e) {
      console.error("[trading-partner-manufacturers]", e);
      cache = { expiresAt: Date.now() + 60_000, options: [] };
      return [];
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export type CustomerInfoFormFieldApiShape = {
  key: string;
  fieldId: string;
  label: string;
  type: string;
  options?: string[];
  optionsPending?: boolean;
  liffOnly?: boolean;
  value: string;
};

/** メーカー欄に取引先会社一覧の選択肢を載せる（既存値がリスト外でも保持） */
export async function enrichCustomerInfoFormFieldsWithManufacturers<
  T extends CustomerInfoFormFieldApiShape,
>(formFields: T[], currentManufacturer?: string): Promise<T[]> {
  const options = await fetchTradingPartnerManufacturerOptions();
  if (options === null) return formFields;

  const merged = [...options];
  const current = nfkc(currentManufacturer ?? "");
  if (current && !merged.includes(current)) {
    merged.push(current);
    merged.sort((a, b) => a.localeCompare(b, "ja"));
  }

  return formFields.map((f) => {
    if (f.key !== "manufacturer") return f;
    return {
      ...f,
      options: merged,
      optionsPending: false,
    };
  });
}
