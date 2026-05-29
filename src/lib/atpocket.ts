import "server-only";

export type AtPocketRecordRow = {
  recordId?: number;
  id?: number;
  uniqueId?: string;
  record?: Record<string, unknown>;
  /** 一覧 API が返す編集画面への URL（環境により付与） */
  accessEditUrl?: string;
  updatedAt?: string;
  createdAt?: string;
};

export type AtPocketCreateRecordResult = {
  row: AtPocketRecordRow;
  /** HTTP Location（…/records/{id} 等） */
  location?: string | null;
};

export type AtPocketListResponse = {
  records?: AtPocketRecordRow[];
};

export type AtPocketFieldRow = {
  uniqueId?: string;
  caption?: string;
  /** GET /api/apps/{appsId}/fields が返す項目タイプ（連携項目の判定など） */
  fieldType?: string;
};

function baseUrl(): string {
  const domain = process.env.ATPOCKET_DOMAIN?.trim();
  if (!domain) {
    throw new Error("ATPOCKET_DOMAIN is not set");
  }
  const normalized = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${normalized}`;
}

function authHeaderName(): string {
  return (
    process.env.ATPOCKET_AUTH_HEADER?.trim() || "X-At-Pocket-API-Key"
  );
}

function apiKey(): string {
  const key = process.env.ATPOCKET_API_KEY?.trim();
  if (!key) {
    throw new Error("ATPOCKET_API_KEY is not set");
  }
  return key;
}

/** 工事カレンダー用アプリの読み取りキー（未設定時は ATPOCKET_API_KEY） */
export function apiKeyForCalendarPocket(): string {
  const k = process.env.CALENDAR_ATPOCKET_API_KEY?.trim();
  if (k) return k;
  return apiKey();
}

/** 工事報告アプリ読み取り用キー（未設定時は工事カレンダー用キー／それも無ければ ATPOCKET_API_KEY） */
export function apiKeyForCalendarReportPocket(): string {
  const k = process.env.CALENDAR_REPORT_ATPOCKET_API_KEY?.trim();
  if (k) return k;
  return apiKeyForCalendarPocket();
}

/** 工事カレンダーアプリのレコード更新用（書き込み権限のあるキー。未設定時は CALENDAR_ATPOCKET_API_KEY → ATPOCKET_API_KEY） */
export function apiKeyForCalendarWrite(): string {
  const w = process.env.CALENDAR_WRITE_ATPOCKET_API_KEY?.trim();
  if (w) return w;
  return apiKeyForCalendarPocket();
}

/** スタッフ名簿アプリの読み取り用（お客様情報の勤務場所参照など。未設定時は ATPOCKET_API_KEY） */
export function apiKeyForStaffPocketRead(): string {
  const k = process.env.STAFF_READ_ATPOCKET_API_KEY?.trim();
  if (k) return k;
  return apiKey();
}

/** スタッフ名簿アプリの LINE 紐付け更新用（未設定時は ATPOCKET_API_KEY・書き込み権限が必要） */
export function apiKeyForStaffWrite(): string {
  const w = process.env.STAFF_WRITE_ATPOCKET_API_KEY?.trim();
  if (w) return w;
  return apiKey();
}

/** お客様情報アプリの読み取り・登録とも同じキー（未設定時は ATPOCKET_API_KEY） */
export function apiKeyForCustomerInfoPocket(): string {
  const k = process.env.CUSTOMER_INFO_ATPOCKET_API_KEY?.trim();
  if (k) return k;
  return apiKey();
}

/** PT集計表（営業ダッシュボード）読み取り専用。未設定時はお客様情報キー → ATPOCKET_API_KEY */
export function apiKeyForSalesDashboardPtPocket(): string {
  const k = process.env.SALES_DASHBOARD_PT_ATPOCKET_API_KEY?.trim();
  if (k) return k;
  return apiKeyForCustomerInfoPocket();
}

/** アポ取得情報連携（営業ダッシュボード）読み取り専用 */
export function apiKeyForSalesDashboardApoPocket(): string {
  const k = process.env.SALES_DASHBOARD_APO_ATPOCKET_API_KEY?.trim();
  if (k) return k;
  return apiKeyForCustomerInfoPocket();
}

export type AtPocketFetchAuth = {
  apiKey?: string;
};

/** ログ・障害調査用（どの環境変数のキーか） */
export type AtPocketRequestContext = {
  operation: string;
  appEnv?: string;
};

function authKeyEnvLabel(auth?: AtPocketFetchAuth): string {
  const key = (auth?.apiKey ?? apiKey()).trim();
  const candidates: Array<[string, string | undefined]> = [
    [
      "SALES_DASHBOARD_PT_ATPOCKET_API_KEY",
      process.env.SALES_DASHBOARD_PT_ATPOCKET_API_KEY?.trim(),
    ],
    [
      "SALES_DASHBOARD_APO_ATPOCKET_API_KEY",
      process.env.SALES_DASHBOARD_APO_ATPOCKET_API_KEY?.trim(),
    ],
    ["CUSTOMER_INFO_ATPOCKET_API_KEY", process.env.CUSTOMER_INFO_ATPOCKET_API_KEY?.trim()],
    ["STAFF_READ_ATPOCKET_API_KEY", process.env.STAFF_READ_ATPOCKET_API_KEY?.trim()],
    ["STAFF_WRITE_ATPOCKET_API_KEY", process.env.STAFF_WRITE_ATPOCKET_API_KEY?.trim()],
    ["CALENDAR_ATPOCKET_API_KEY", process.env.CALENDAR_ATPOCKET_API_KEY?.trim()],
    ["CALENDAR_WRITE_ATPOCKET_API_KEY", process.env.CALENDAR_WRITE_ATPOCKET_API_KEY?.trim()],
    ["CALENDAR_REPORT_ATPOCKET_API_KEY", process.env.CALENDAR_REPORT_ATPOCKET_API_KEY?.trim()],
    ["TRADING_PARTNER_ATPOCKET_API_KEY", process.env.TRADING_PARTNER_ATPOCKET_API_KEY?.trim()],
    ["PRODUCT_CATALOG_ATPOCKET_API_KEY", process.env.PRODUCT_CATALOG_ATPOCKET_API_KEY?.trim()],
    ["LOG_ATPOCKET_API_KEY", process.env.LOG_ATPOCKET_API_KEY?.trim()],
    ["ATPOCKET_API_KEY", process.env.ATPOCKET_API_KEY?.trim()],
  ];
  for (const [name, envVal] of candidates) {
    if (envVal && key === envVal) return name;
  }
  return auth?.apiKey ? "custom(apiKey)" : "ATPOCKET_API_KEY(default)";
}

function formatPocketHttpError(
  kind: string,
  status: number,
  text: string,
  appsId: string,
  auth?: AtPocketFetchAuth,
  ctx?: AtPocketRequestContext,
): string {
  const segments = [
    `@pocket ${kind} failed: ${status} ${text}`,
    `operation=${ctx?.operation ?? "unknown"}`,
    `appsId=${appsId}`,
    ctx?.appEnv ? `appsEnv=${ctx.appEnv}` : "",
    `apiKey=${authKeyEnvLabel(auth)}`,
  ].filter(Boolean);
  if (status === 401) {
    segments.push(
      "hint=この apiKey に上記 appsId の参照権限があるか @pocket 管理画面で確認",
    );
  } else if (status === 429) {
    segments.push("hint=100秒あたりのAPI上限。間隔を空けて再試行");
  }
  return segments.join(" | ");
}

/** ログアプリ・工事カレンダーアプリへのレコード登録用キー */
function apiKeyForCreateRecord(appsId: string): string {
  const logAppId = process.env.LOG_APP_ID?.trim();
  const logKey = process.env.LOG_ATPOCKET_API_KEY?.trim();
  if (logAppId && appsId === logAppId && logKey) {
    return logKey;
  }
  const calAppId = process.env.CALENDAR_APP_ID?.trim();
  if (calAppId && appsId === calAppId) {
    return apiKeyForCalendarWrite();
  }
  const customerInfoAppId = process.env.CUSTOMER_INFO_APP_ID?.trim();
  if (customerInfoAppId && appsId === customerInfoAppId) {
    return apiKeyForCustomerInfoPocket();
  }
  return apiKey();
}

async function fetchWithMethodOverride(
  pathWithQuery: string,
  auth?: AtPocketFetchAuth,
): Promise<Response> {
  const url = `${baseUrl()}${pathWithQuery}`;
  const key = auth?.apiKey ?? apiKey();
  return fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      [authHeaderName()]: key,
      "X-HTTP-Method-Override": "GET",
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(headers: Headers): number | null {
  const ra = headers.get("retry-after");
  if (ra) {
    const sec = Number(ra);
    if (Number.isFinite(sec) && sec >= 0) {
      return Math.min(sec * 1000, 60_000);
    }
    const when = Date.parse(ra);
    if (!Number.isNaN(when)) {
      return Math.max(0, Math.min(when - Date.now(), 60_000));
    }
  }
  return null;
}

const POCKET_GET_RETRY_MAX = 5;
const POCKET_GET_RETRY_BASE_MS = 450;

export type PocketListFetchOptions = {
  /** 429 時の最大再試行回数（既定 5）。スタッフ名簿などは 1 推奨 */
  maxRetries?: number;
};

/** 429 のとき指数バックオフで再試行（429 応答は本文を読み捨て済みであること） */
async function fetchWithMethodOverrideWithRetry(
  pathWithQuery: string,
  auth?: AtPocketFetchAuth,
  options?: PocketListFetchOptions,
): Promise<Response> {
  const maxAttempts = Math.max(
    1,
    Math.min(POCKET_GET_RETRY_MAX, options?.maxRetries ?? POCKET_GET_RETRY_MAX),
  );
  let last: Response | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetchWithMethodOverride(pathWithQuery, auth);
    last = res;
    if (res.status !== 429) return res;
    if (attempt === maxAttempts - 1) return res;
    await res.text();
    const wait =
      parseRetryAfterMs(res.headers) ??
      Math.min(14_000, POCKET_GET_RETRY_BASE_MS * 2 ** attempt);
    await sleep(wait + Math.floor(Math.random() * 220));
  }
  return last as Response;
}

/** @pocket docs: auth key header is tied to POST; use override for GET semantics */
export async function fetchRecordsList(
  appsId: string,
  searchParams?: {
    limit?: string;
    page?: string;
    fields?: string;
    query?: string;
  },
  auth?: AtPocketFetchAuth,
  ctx?: AtPocketRequestContext,
  options?: PocketListFetchOptions,
): Promise<AtPocketListResponse> {
  const params = new URLSearchParams();
  params.set("limit", searchParams?.limit ?? "1000");
  if (searchParams?.page) params.set("page", searchParams.page);
  if (searchParams?.fields) params.set("fields", searchParams.fields);
  if (searchParams?.query) params.set("query", searchParams.query);
  const qs = params.toString();
  const path = `/api/apps/${appsId}/records${qs ? `?${qs}` : ""}`;

  const res = await fetchWithMethodOverrideWithRetry(path, auth, options);

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      formatPocketHttpError(
        "list records",
        res.status,
        text,
        appsId,
        auth,
        ctx,
      ),
    );
  }
  return text ? (JSON.parse(text) as AtPocketListResponse) : { records: [] };
}

/** アプリのフィールド定義一覧 GET /api/apps/{appsId}/fields（短時間キャッシュで一覧連打を抑制） */
const APP_FIELDS_TTL_MS = 5 * 60 * 1000;
type FieldsCacheEntry = { expiresAt: number; fields: AtPocketFieldRow[] };
const appFieldsStore = new Map<string, FieldsCacheEntry>();
const appFieldsInflight = new Map<string, Promise<AtPocketFieldRow[]>>();

async function fetchAppFieldsOnce(
  appsId: string,
  auth?: AtPocketFetchAuth,
  ctx?: AtPocketRequestContext,
): Promise<AtPocketFieldRow[]> {
  const params = new URLSearchParams();
  params.set("limit", "1000");
  params.set("page", "1");
  const path = `/api/apps/${appsId}/fields?${params.toString()}`;
  const res = await fetchWithMethodOverrideWithRetry(path, auth);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      formatPocketHttpError("list fields", res.status, text, appsId, auth, ctx),
    );
  }
  if (!text) return [];
  const json = JSON.parse(text) as { fields?: AtPocketFieldRow[] };
  return json.fields ?? [];
}

/** 列定義キャッシュを破棄（@pocket で列追加直後の PUT 向け） */
export function invalidateAppFieldsCache(appsId: string): void {
  const key = appsId.trim();
  appFieldsStore.delete(key);
  appFieldsInflight.delete(key);
}

export async function fetchAppFields(
  appsId: string,
  auth?: AtPocketFetchAuth,
  ctx?: AtPocketRequestContext,
): Promise<AtPocketFieldRow[]> {
  const key = appsId.trim();
  const now = Date.now();
  const hit = appFieldsStore.get(key);
  if (hit && hit.expiresAt > now) return hit.fields;

  const pending = appFieldsInflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const fields = await fetchAppFieldsOnce(appsId, auth, ctx);
      appFieldsStore.set(key, {
        expiresAt: Date.now() + APP_FIELDS_TTL_MS,
        fields,
      });
      return fields;
    } finally {
      appFieldsInflight.delete(key);
    }
  })();

  appFieldsInflight.set(key, promise);
  return promise;
}

/** アプリのフィールド定義にある uniqueId のみ残す。GET の record に混ざる無効キーで PUT が 400 になるのを防ぐ */
export function pickRecordFieldsForSchema(
  record: Record<string, unknown>,
  schemaUniqueIds: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (schemaUniqueIds.has(k)) out[k] = v;
  }
  return out;
}

/**
 * GET の record に混ざる `field-123` 形式は、環境によっては PUT で拒否される。
 * ただし @pocket 管理画面のフィールド識別名そのものが `field-1` などである場合があり、そのキーは削除しない。
 */
export function stripLikelyInvalidPocketKeysFromRecord(
  record: Record<string, unknown>,
  preserveHyphenNumericFieldKeys?: Set<string>,
): Record<string, unknown> {
  const preserve = preserveHyphenNumericFieldKeys ?? new Set<string>();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (/^field-\d+$/i.test(k)) {
      if (preserve.has(k)) out[k] = v;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** 複数 API キーを順に試し、フィールド定義一覧を返す。すべて失敗なら null（403 対策） */
export async function fetchAppFieldsTryKeys(
  appsId: string,
  apiKeysInOrder: string[],
): Promise<AtPocketFieldRow[] | null> {
  const dedup = new Set<string>();
  const keys = apiKeysInOrder
    .map((k) => k?.trim())
    .filter((k): k is string => Boolean(k))
    .filter((k) => {
      if (dedup.has(k)) return false;
      dedup.add(k);
      return true;
    });

  for (const apiKey of keys) {
    try {
      return await fetchAppFields(appsId, { apiKey });
    } catch {
      /* 次のキー */
    }
  }
  return null;
}

/** 複数 API キーを順に試し、フィールド一覧が取れたら uniqueId の集合を返す。すべて失敗なら null */
export async function fetchAppFieldUniqueIdsSetTryKeys(
  appsId: string,
  apiKeysInOrder: string[],
): Promise<Set<string> | null> {
  const defs = await fetchAppFieldsTryKeys(appsId, apiKeysInOrder);
  if (!defs) return null;
  return new Set(
    defs
      .map((f) => f.uniqueId?.trim())
      .filter((u): u is string => Boolean(u)),
  );
}

const CALENDAR_PAGE_LIMIT = 1000;
const CALENDAR_MAX_PAGES = 200;

export type FetchAllRecordsPagesOptions = PocketListFetchOptions & {
  /** 最大ページ数（未指定時は CALENDAR_MAX_PAGES） */
  maxPages?: number;
};

/** @pocket 一覧をページングで全件取得（工事カレンダーなど） */
export async function fetchAllRecordsPages(
  appsId: string,
  fieldsCsv: string,
  auth?: AtPocketFetchAuth,
  pocketQuery?: string | null,
  ctx?: AtPocketRequestContext,
  options?: FetchAllRecordsPagesOptions,
): Promise<AtPocketRecordRow[]> {
  const pageCap = Math.max(
    1,
    Math.min(
      CALENDAR_MAX_PAGES,
      options?.maxPages ?? CALENDAR_MAX_PAGES,
    ),
  );
  const listOptions: PocketListFetchOptions = {
    maxRetries: options?.maxRetries,
  };
  const all: AtPocketRecordRow[] = [];
  for (let page = 1; page <= pageCap; page++) {
    const data = await fetchRecordsList(
      appsId,
      {
        limit: String(CALENDAR_PAGE_LIMIT),
        page: String(page),
        fields: fieldsCsv,
        ...(pocketQuery?.trim() ? { query: pocketQuery.trim() } : {}),
      },
      auth,
      ctx,
      listOptions,
    );
    const recs = data.records ?? [];
    all.push(...recs);
    if (recs.length < CALENDAR_PAGE_LIMIT) break;
  }
  return all;
}

/** 単一レコード GET /api/apps/{appsId}/records/{recordId}（fields は一覧APIと同様の CSV・任意） */
export async function fetchRecordById(
  appsId: string,
  recordId: string,
  auth?: AtPocketFetchAuth,
  fieldsCsv?: string,
): Promise<AtPocketRecordRow | null> {
  let path = `/api/apps/${appsId}/records/${encodeURIComponent(recordId)}`;
  const csv = fieldsCsv?.trim();
  if (csv) {
    path += `?fields=${encodeURIComponent(csv)}`;
  }
  const res = await fetchWithMethodOverrideWithRetry(path, auth);
  const text = await res.text();
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`@pocket get record failed: ${res.status} ${text}`);
  }
  if (!text) return null;
  return JSON.parse(text) as AtPocketRecordRow;
}

export async function createRecord(
  appsId: string,
  record: Record<string, unknown>,
  auth?: AtPocketFetchAuth,
): Promise<AtPocketCreateRecordResult> {
  const url = `${baseUrl()}/api/apps/${appsId}/records`;
  const key = auth?.apiKey ?? apiKeyForCreateRecord(appsId);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      [authHeaderName()]: key,
    },
    body: JSON.stringify({ record }),
  });

  const text = await res.text();
  const location = res.headers.get("location") ?? res.headers.get("Location");
  if (!res.ok) {
    throw new Error(`@pocket create record failed: ${res.status} ${text}`);
  }
  let row: AtPocketRecordRow = {};
  if (text) {
    try {
      row = JSON.parse(text) as AtPocketRecordRow;
    } catch {
      row = {};
    }
  }
  return { row, location };
}

/** レコード更新 PUT /api/apps/{appsId}/records/{recordId} */
export async function updateRecord(
  appsId: string,
  recordId: string,
  record: Record<string, unknown>,
  auth?: AtPocketFetchAuth,
): Promise<void> {
  const url = `${baseUrl()}/api/apps/${appsId}/records/${encodeURIComponent(recordId)}`;
  const key = auth?.apiKey ?? apiKey();
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      [authHeaderName()]: key,
    },
    body: JSON.stringify({ record }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`@pocket update record failed: ${res.status} ${text}`);
  }
}
