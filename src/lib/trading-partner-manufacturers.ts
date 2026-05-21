import "server-only";

import type { AtPocketFetchAuth, AtPocketFieldRow } from "@/lib/atpocket";
import {
  apiKeyForCustomerInfoPocket,
  fetchAllRecordsPages,
  fetchAppFields,
} from "@/lib/atpocket";
import {
  pickRecordValueByFieldAliases,
  resolveConfiguredFieldToSchemaUniqueId,
} from "@/lib/calendar-kojo";
import {
  nfkcNormalize,
  pocketTableCellToPlainString,
} from "@/lib/staff-construction-availability";

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

function readRecordCell(
  rec: Record<string, unknown>,
  fieldId: string,
): unknown {
  return pickRecordValueByFieldAliases(rec, fieldId);
}

/** 単一選択・複数選択・オブジェクト形式のセルをトークン列に分解 */
export function pocketSelectTokens(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const item of raw) {
      out.push(...pocketSelectTokens(item));
    }
    return [...new Set(out.map(nfkcNormalize).filter(Boolean))];
  }
  const cell = pocketTableCellToPlainString(raw);
  if (!cell) return [];
  const norm = nfkcNormalize(cell);
  const parts = norm
    .split(/[,、/／|]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [norm];
  return [...new Set(parts)];
}

export function pocketSelectIncludesLabel(
  raw: unknown,
  expected: string,
): boolean {
  const want = nfkcNormalize(expected);
  return pocketSelectTokens(raw).includes(want);
}

function readCompanyNameCell(
  rec: Record<string, unknown>,
  fieldId: string,
): string {
  return nfkcNormalize(pocketTableCellToPlainString(readRecordCell(rec, fieldId)));
}

function collectManufacturerNames(
  rows: Awaited<ReturnType<typeof fetchAllRecordsPages>>,
  ids: TradingPartnerFieldIds,
): string[] {
  const names = new Set<string>();
  let matched = 0;
  const typeSamples: string[] = [];
  const statusSamples: string[] = [];

  for (const row of rows) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const recObj = rec as Record<string, unknown>;

    const typeRaw = readRecordCell(recObj, ids.companyType);
    const statusRaw = readRecordCell(recObj, ids.tradeStatus);
    if (typeSamples.length < 5) {
      typeSamples.push(pocketSelectTokens(typeRaw).join("|") || "(空)");
    }
    if (statusSamples.length < 5) {
      statusSamples.push(pocketSelectTokens(statusRaw).join("|") || "(空)");
    }
    if (!pocketSelectIncludesLabel(typeRaw, COMPANY_TYPE_MANUFACTURER)) {
      continue;
    }
    if (!pocketSelectIncludesLabel(statusRaw, TRADE_STATUS_ACTIVE)) {
      continue;
    }
    matched += 1;
    const name = readCompanyNameCell(recObj, ids.companyName);
    if (name) names.add(name);
  }

  console.info(
    `[trading-partner-manufacturers] rows=${rows.length} matched=${matched} manufacturers=${names.size}`,
  );
  if (matched === 0 && rows.length > 0) {
    console.warn(
      "[trading-partner-manufacturers] 条件に合致する行がありません。サンプル 会社種別:",
      typeSamples,
      "取引状況:",
      statusSamples,
    );
  }

  return [...names].sort((a, b) => a.localeCompare(b, "ja"));
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
  let rows = await fetchAllRecordsPages(appId, fieldsCsv, auth);
  let names = collectManufacturerNames(rows, ids);

  // fields 指定で値が欠ける・キーがずれる場合に全項目取得で再試行
  if (names.length <= 1 && rows.length >= 2) {
    const fullRows = await fetchAllRecordsPages(appId, "", auth);
    const retryNames = collectManufacturerNames(fullRows, ids);
    if (retryNames.length > names.length) {
      names = retryNames;
    }
  }

  return names;
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
