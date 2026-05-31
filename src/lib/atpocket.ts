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
  /** Location / Content-Location 等から抽出した recordId */
  recordIdHint?: string | null;
  /** POST 応答の生テキスト（JSON 以外・URL 埋め込み用） */
  rawBody?: string | null;
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

/**
 * 環境変数のうち最初に値がある API キー。
 * スタッフ名簿: ATPOCKET_API_KEY / ATPOCKET_API_KEY_1 / ATPOCKET_API_KEY_2（名簿権限のみ）
 * その他アプリ: {PREFIX}_ATPOCKET_API_KEY / _1 / _2（読取①・読取②・更新③・429分散）
 */
function firstEnvApiKey(...envNames: string[]): string | undefined {
  for (const name of envNames) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return undefined;
}

function apiKeyForScope(
  scopedNames: string[],
  fallback: () => string,
): string {
  return firstEnvApiKey(...scopedNames) ?? fallback();
}

function resolvePassedApiKey(auth?: AtPocketFetchAuth): string {
  const key = auth?.apiKey?.trim();
  if (!key) {
    throw new Error(
      "@pocket API 呼び出しに apiKey が未指定です。機能別の環境変数からキーを渡してください",
    );
  }
  return key;
}

/** スタッフ名簿用3キー（いずれも名簿権限のみ） */
function requireStaffApiKey(
  slot: "ATPOCKET_API_KEY" | "ATPOCKET_API_KEY_1" | "ATPOCKET_API_KEY_2",
  legacyEnvNames: string[],
): string {
  const key = firstEnvApiKey(...legacyEnvNames, slot);
  if (!key) {
    throw new Error(
      `スタッフ名簿用 ${slot} を設定してください（従来名: ${legacyEnvNames.join(" / ")}）`,
    );
  }
  return key;
}

/** 機能別3キー（読取① / 読取② / 更新③） */
function requireAppApiKey(
  prefix: string,
  slot: 0 | 1 | 2,
  legacyEnvNames: string[] = [],
): string {
  const envName =
    slot === 0
      ? `${prefix}_ATPOCKET_API_KEY`
      : `${prefix}_ATPOCKET_API_KEY_${slot}`;
  const key = firstEnvApiKey(...legacyEnvNames, envName);
  if (!key) {
    throw new Error(
      `${prefix} 用 ${envName} を設定してください${legacyEnvNames.length ? `（従来名: ${legacyEnvNames.join(" / ")}）` : ""}`,
    );
  }
  return key;
}

/** 工事カレンダー・読取①（月一覧など） */
export function apiKeyForCalendarPocket(): string {
  return requireAppApiKey("CALENDAR", 0, []);
}

/** 工事カレンダー・読取②（fields 取得など） */
export function apiKeyForCalendarPocket1(): string {
  return requireAppApiKey("CALENDAR", 1, []);
}

/** 工事カレンダー・更新③（空枠・新規登録など） */
export function apiKeyForCalendarWrite(): string {
  return requireAppApiKey("CALENDAR", 2, [
    "CALENDAR_WRITE_ATPOCKET_API_KEY",
    "CALENDAR_WRITE_ATPOCKET_API_KEY_2",
  ]);
}

/** 工事報告アプリ・読取①（一覧など） */
export function apiKeyForCalendarReportPocket(): string {
  const key = firstEnvApiKey(
    "CALENDAR_REPORT_ATPOCKET_API_KEY",
    "CALENDAR_REPORT_ATPOCKET_API_KEY_1",
    "CALENDAR_REPORT_ATPOCKET_API_KEY_2",
  );
  if (key) return key;
  return apiKeyForCalendarPocket1();
}

/** 工事報告アプリ・読取②（fields など・429 分散用） */
export function apiKeyForCalendarReportPocket1(): string {
  const key = firstEnvApiKey(
    "CALENDAR_REPORT_ATPOCKET_API_KEY_1",
    "CALENDAR_REPORT_ATPOCKET_API_KEY_2",
  );
  if (key) return key;
  return apiKeyForCalendarReportPocket();
}

/** スタッフ名簿・読取①（名簿一覧・勤務場所・PIN照会など） */
export function apiKeyForStaffPocketRead(): string {
  return requireStaffApiKey("ATPOCKET_API_KEY", [
    "STAFF_READ_ATPOCKET_API_KEY",
  ]);
}

/** スタッフ名簿・読取②（AP/CL担当者・工事対応者リストなど） */
export function apiKeyForStaffPocketRead1(): string {
  return requireStaffApiKey("ATPOCKET_API_KEY_1", [
    "STAFF_READ_ATPOCKET_API_KEY_1",
  ]);
}

/** スタッフ名簿・更新③（LINE紐付け・PIN設定など） */
export function apiKeyForStaffWrite(): string {
  return requireStaffApiKey("ATPOCKET_API_KEY_2", [
    "STAFF_WRITE_ATPOCKET_API_KEY",
    "STAFF_WRITE_ATPOCKET_API_KEY_1",
  ]);
}

/** お客様情報・読取①（CRM一覧・単票GETなど） */
export function apiKeyForCustomerInfoPocket(): string {
  return requireAppApiKey("CUSTOMER_INFO", 0, []);
}

/** お客様情報・読取②（検索・未入力一覧・キー照合など） */
export function apiKeyForCustomerInfoPocket1(): string {
  return requireAppApiKey("CUSTOMER_INFO", 1, []);
}

/** お客様情報・更新③（PUT・工事連携登録など） */
export function apiKeyForCustomerInfoWrite(): string {
  return requireAppApiKey("CUSTOMER_INFO", 2, []);
}

/** 取引先会社一覧・読取① */
export function apiKeyForTradingPartnerPocket(): string {
  return requireAppApiKey("TRADING_PARTNER", 0, []);
}

/** 取引先会社一覧・読取②（fields 再試行など） */
export function apiKeyForTradingPartnerPocket1(): string {
  return requireAppApiKey("TRADING_PARTNER", 1, []);
}

/** 商品一覧・読取① */
export function apiKeyForProductCatalogPocket(): string {
  return requireAppApiKey("PRODUCT_CATALOG", 0, []);
}

/** 商品一覧・読取② */
export function apiKeyForProductCatalogPocket1(): string {
  return requireAppApiKey("PRODUCT_CATALOG", 1, []);
}

/** ログアプリ・更新③ */
export function apiKeyForLogPocketWrite(): string {
  return requireAppApiKey("LOG", 2, ["LOG_ATPOCKET_API_KEY"]);
}

/** PT集計表・読取①（fields） */
export function apiKeyForSalesDashboardPtPocket(): string {
  return apiKeyForAppFields("SALES_DASHBOARD_PT");
}

/** PT集計表・読取②（list・後方互換） */
export function apiKeyForSalesDashboardPtPocket1(): string {
  const auths = listAuthsForAppList("SALES_DASHBOARD_PT");
  return auths[0]?.apiKey ?? requireAppApiKey("SALES_DASHBOARD_PT", 1, []);
}

/** アポ取得情報・読取①（fields） */
export function apiKeyForSalesDashboardApoPocket(): string {
  return apiKeyForAppFields("SALES_DASHBOARD_APO");
}

/** アポ取得情報・読取②（list・後方互換） */
export function apiKeyForSalesDashboardApoPocket1(): string {
  const auths = listAuthsForAppList("SALES_DASHBOARD_APO");
  return auths[0]?.apiKey ?? requireAppApiKey("SALES_DASHBOARD_APO", 1, []);
}

/** PT集計表・読取③（list ローテ用サブキー・未設定時は LIST_2 → 読取②） */
export function apiKeyForSalesDashboardPtPocket2(): string {
  return (
    firstEnvApiKey(
      "SALES_DASHBOARD_PT_ATPOCKET_API_KEY_LIST_2",
      "SALES_DASHBOARD_PT_ATPOCKET_API_KEY_2",
    ) ?? apiKeyForSalesDashboardPtPocket1()
  );
}

/** アポ取得情報・読取③（list ローテ用サブキー・未設定時は LIST_2 → 読取②） */
export function apiKeyForSalesDashboardApoPocket2(): string {
  return (
    firstEnvApiKey(
      "SALES_DASHBOARD_APO_ATPOCKET_API_KEY_LIST_2",
      "SALES_DASHBOARD_APO_ATPOCKET_API_KEY_2",
    ) ?? apiKeyForSalesDashboardApoPocket1()
  );
}

function collectDistinctApiKeys(envNames: string[]): AtPocketFetchAuth[] {
  const keys: string[] = [];
  for (const envName of envNames) {
    const k = process.env[envName]?.trim();
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys.map((apiKey) => ({ apiKey }));
}

/** fields 用サブキー（未設定時は読取①） */
export function apiKeyForAppFields(
  prefix: string,
  extraEnvNames: string[] = [],
): string {
  const key = firstEnvApiKey(
    ...extraEnvNames,
    `${prefix}_ATPOCKET_API_KEY_FIELDS`,
    `${prefix}_ATPOCKET_API_KEY`,
  );
  if (key) return key;
  return requireAppApiKey(prefix, 0, []);
}

/** 一覧ページング用サブキー（未設定時は読取②③①の順で重複除外） */
export function listAuthsForAppList(
  prefix: string,
  extraEnvNames: string[] = [],
): AtPocketFetchAuth[] {
  const auths = collectDistinctApiKeys([
    ...extraEnvNames,
    `${prefix}_ATPOCKET_API_KEY_LIST_3`,
    `${prefix}_ATPOCKET_API_KEY_LIST_2`,
    `${prefix}_ATPOCKET_API_KEY_LIST_1`,
    `${prefix}_ATPOCKET_API_KEY_LIST`,
    `${prefix}_ATPOCKET_API_KEY_2`,
    `${prefix}_ATPOCKET_API_KEY_1`,
    `${prefix}_ATPOCKET_API_KEY`,
  ]);
  if (auths.length > 0) return auths;
  return [{ apiKey: requireAppApiKey(prefix, 1, []) }];
}

/** @deprecated listAuthsForAppList を使用 */
export function listAuthsForAppPrefix(prefix: string): AtPocketFetchAuth[] {
  return listAuthsForAppList(prefix);
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
  const key = auth?.apiKey?.trim();
  if (!key) return "unset";
  const candidates: Array<[string, string | undefined]> = [
    [
      "SALES_DASHBOARD_PT_ATPOCKET_API_KEY_LIST_3",
      process.env.SALES_DASHBOARD_PT_ATPOCKET_API_KEY_LIST_3?.trim(),
    ],
    [
      "SALES_DASHBOARD_PT_ATPOCKET_API_KEY_LIST_2",
      process.env.SALES_DASHBOARD_PT_ATPOCKET_API_KEY_LIST_2?.trim(),
    ],
    [
      "SALES_DASHBOARD_PT_ATPOCKET_API_KEY_LIST_1",
      process.env.SALES_DASHBOARD_PT_ATPOCKET_API_KEY_LIST_1?.trim(),
    ],
    [
      "SALES_DASHBOARD_PT_ATPOCKET_API_KEY_FIELDS",
      process.env.SALES_DASHBOARD_PT_ATPOCKET_API_KEY_FIELDS?.trim(),
    ],
    [
      "SALES_DASHBOARD_APO_ATPOCKET_API_KEY_LIST_3",
      process.env.SALES_DASHBOARD_APO_ATPOCKET_API_KEY_LIST_3?.trim(),
    ],
    [
      "SALES_DASHBOARD_APO_ATPOCKET_API_KEY_LIST_2",
      process.env.SALES_DASHBOARD_APO_ATPOCKET_API_KEY_LIST_2?.trim(),
    ],
    [
      "SALES_DASHBOARD_APO_ATPOCKET_API_KEY_LIST_1",
      process.env.SALES_DASHBOARD_APO_ATPOCKET_API_KEY_LIST_1?.trim(),
    ],
    [
      "SALES_DASHBOARD_APO_ATPOCKET_API_KEY_FIELDS",
      process.env.SALES_DASHBOARD_APO_ATPOCKET_API_KEY_FIELDS?.trim(),
    ],
    [
      "CUSTOMER_INFO_ATPOCKET_API_KEY_DASHBOARD_LIST_3",
      process.env.CUSTOMER_INFO_ATPOCKET_API_KEY_DASHBOARD_LIST_3?.trim(),
    ],
    [
      "CUSTOMER_INFO_ATPOCKET_API_KEY_DASHBOARD_LIST_2",
      process.env.CUSTOMER_INFO_ATPOCKET_API_KEY_DASHBOARD_LIST_2?.trim(),
    ],
    [
      "CUSTOMER_INFO_ATPOCKET_API_KEY_DASHBOARD_LIST_1",
      process.env.CUSTOMER_INFO_ATPOCKET_API_KEY_DASHBOARD_LIST_1?.trim(),
    ],
    [
      "CUSTOMER_INFO_ATPOCKET_API_KEY_DASHBOARD_FIELDS",
      process.env.CUSTOMER_INFO_ATPOCKET_API_KEY_DASHBOARD_FIELDS?.trim(),
    ],
    [
      "SALES_DASHBOARD_PT_ATPOCKET_API_KEY_2",
      process.env.SALES_DASHBOARD_PT_ATPOCKET_API_KEY_2?.trim(),
    ],
    [
      "SALES_DASHBOARD_PT_ATPOCKET_API_KEY_1",
      process.env.SALES_DASHBOARD_PT_ATPOCKET_API_KEY_1?.trim(),
    ],
    [
      "SALES_DASHBOARD_PT_ATPOCKET_API_KEY",
      process.env.SALES_DASHBOARD_PT_ATPOCKET_API_KEY?.trim(),
    ],
    [
      "SALES_DASHBOARD_APO_ATPOCKET_API_KEY_2",
      process.env.SALES_DASHBOARD_APO_ATPOCKET_API_KEY_2?.trim(),
    ],
    [
      "SALES_DASHBOARD_APO_ATPOCKET_API_KEY_1",
      process.env.SALES_DASHBOARD_APO_ATPOCKET_API_KEY_1?.trim(),
    ],
    [
      "SALES_DASHBOARD_APO_ATPOCKET_API_KEY",
      process.env.SALES_DASHBOARD_APO_ATPOCKET_API_KEY?.trim(),
    ],
    [
      "CUSTOMER_INFO_ATPOCKET_API_KEY_2",
      process.env.CUSTOMER_INFO_ATPOCKET_API_KEY_2?.trim(),
    ],
    [
      "CUSTOMER_INFO_ATPOCKET_API_KEY_1",
      process.env.CUSTOMER_INFO_ATPOCKET_API_KEY_1?.trim(),
    ],
    ["CUSTOMER_INFO_ATPOCKET_API_KEY", process.env.CUSTOMER_INFO_ATPOCKET_API_KEY?.trim()],
    [
      "STAFF_READ_ATPOCKET_API_KEY_1",
      process.env.STAFF_READ_ATPOCKET_API_KEY_1?.trim(),
    ],
    ["STAFF_READ_ATPOCKET_API_KEY", process.env.STAFF_READ_ATPOCKET_API_KEY?.trim()],
    [
      "STAFF_WRITE_ATPOCKET_API_KEY_1",
      process.env.STAFF_WRITE_ATPOCKET_API_KEY_1?.trim(),
    ],
    ["STAFF_WRITE_ATPOCKET_API_KEY", process.env.STAFF_WRITE_ATPOCKET_API_KEY?.trim()],
    [
      "CALENDAR_ATPOCKET_API_KEY_2",
      process.env.CALENDAR_ATPOCKET_API_KEY_2?.trim(),
    ],
    ["CALENDAR_ATPOCKET_API_KEY", process.env.CALENDAR_ATPOCKET_API_KEY?.trim()],
    [
      "CALENDAR_WRITE_ATPOCKET_API_KEY_2",
      process.env.CALENDAR_WRITE_ATPOCKET_API_KEY_2?.trim(),
    ],
    ["CALENDAR_WRITE_ATPOCKET_API_KEY", process.env.CALENDAR_WRITE_ATPOCKET_API_KEY?.trim()],
    [
      "CALENDAR_REPORT_ATPOCKET_API_KEY_2",
      process.env.CALENDAR_REPORT_ATPOCKET_API_KEY_2?.trim(),
    ],
    [
      "CALENDAR_REPORT_ATPOCKET_API_KEY",
      process.env.CALENDAR_REPORT_ATPOCKET_API_KEY?.trim(),
    ],
    [
      "TRADING_PARTNER_ATPOCKET_API_KEY_2",
      process.env.TRADING_PARTNER_ATPOCKET_API_KEY_2?.trim(),
    ],
    [
      "TRADING_PARTNER_ATPOCKET_API_KEY",
      process.env.TRADING_PARTNER_ATPOCKET_API_KEY?.trim(),
    ],
    [
      "PRODUCT_CATALOG_ATPOCKET_API_KEY_2",
      process.env.PRODUCT_CATALOG_ATPOCKET_API_KEY_2?.trim(),
    ],
    [
      "PRODUCT_CATALOG_ATPOCKET_API_KEY",
      process.env.PRODUCT_CATALOG_ATPOCKET_API_KEY?.trim(),
    ],
    ["LOG_ATPOCKET_API_KEY_2", process.env.LOG_ATPOCKET_API_KEY_2?.trim()],
    ["LOG_ATPOCKET_API_KEY", process.env.LOG_ATPOCKET_API_KEY?.trim()],
  ];
  for (const [name, envVal] of candidates) {
    if (envVal && key === envVal) return name;
  }
  return "custom(apiKey)";
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
  const logKey = firstEnvApiKey(
    "LOG_ATPOCKET_API_KEY_2",
    "LOG_ATPOCKET_API_KEY",
  );
  if (logAppId && appsId === logAppId && logKey) {
    return logKey;
  }
  const calAppId = process.env.CALENDAR_APP_ID?.trim();
  if (calAppId && appsId === calAppId) {
    return apiKeyForCalendarWrite();
  }
  const customerInfoAppId = process.env.CUSTOMER_INFO_APP_ID?.trim();
  if (customerInfoAppId && appsId === customerInfoAppId) {
    return apiKeyForCustomerInfoWrite();
  }
  throw new Error(
    `@pocket レコード登録用の API キーが未設定です（appsId=${appsId}）。該当アプリ用の *_ATPOCKET_API_KEY を設定してください`,
  );
}

async function fetchWithMethodOverride(
  pathWithQuery: string,
  auth?: AtPocketFetchAuth,
): Promise<Response> {
  const url = `${baseUrl()}${pathWithQuery}`;
  const key = resolvePassedApiKey(auth);
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

/** @pocket の 100 秒ウィンドウ（同一 API キーでアプリ横断） */
const POCKET_RATE_LIMIT_WINDOW_MS = 100_000;
const pocketRateLimitedUntil = new Map<string, number>();

function pocketRateLimitKey(auth?: AtPocketFetchAuth): string {
  return resolvePassedApiKey(auth);
}

/** 直近の 429 を記録（工事カレンダー等の連打後にスタッフ名簿が巻き添えにならないよう） */
export function markPocketApiRateLimited(auth?: AtPocketFetchAuth): void {
  pocketRateLimitedUntil.set(
    pocketRateLimitKey(auth),
    Date.now() + POCKET_RATE_LIMIT_WINDOW_MS,
  );
}

export function isPocketApiRateLimited(auth?: AtPocketFetchAuth): boolean {
  return Date.now() < (pocketRateLimitedUntil.get(pocketRateLimitKey(auth)) ?? 0);
}

export function pocketApiRateLimitRemainingMs(
  auth?: AtPocketFetchAuth,
): number {
  const until = pocketRateLimitedUntil.get(pocketRateLimitKey(auth)) ?? 0;
  return Math.max(0, until - Date.now());
}

export function isPocketHttpRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes("429") || msg.includes("Too Many Request");
}

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
  if (isPocketApiRateLimited(auth)) {
    const retrySec = Math.max(
      1,
      Math.ceil(pocketApiRateLimitRemainingMs(auth) / 1000),
    );
    return new Response(
      JSON.stringify({
        errors: {
          code: 429,
          message: "Too Many Request",
          details: [
            {
              message: "Request exhausted per 100 second (backoff active)",
            },
          ],
        },
      }),
      {
        status: 429,
        headers: { "Retry-After": String(retrySec) },
      },
    );
  }

  let last: Response | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetchWithMethodOverride(pathWithQuery, auth);
    last = res;
    if (res.status === 429) {
      markPocketApiRateLimited(auth);
    }
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
  /** ページごとにキーをローテーション（429 分散） */
  authKeys?: AtPocketFetchAuth[];
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
  const authKeys =
    options?.authKeys?.filter((a) => a.apiKey?.trim()) ?? [];
  const all: AtPocketRecordRow[] = [];
  for (let page = 1; page <= pageCap; page++) {
    const pageAuth =
      authKeys.length > 0
        ? authKeys[(page - 1) % authKeys.length]
        : auth;
    const data = await fetchRecordsList(
      appsId,
      {
        limit: String(CALENDAR_PAGE_LIMIT),
        page: String(page),
        fields: fieldsCsv,
        ...(pocketQuery?.trim() ? { query: pocketQuery.trim() } : {}),
      },
      pageAuth,
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

function recordIdFromHttpLocationHeader(value: string | null): string | null {
  const s = value?.trim();
  if (!s) return null;
  const m =
    s.match(/\/records\/(\d+)(?:\/|$|[?#])/i) ||
    s.match(/\/record\/(\d+)(?:\/|$|[?#])/i);
  return m?.[1]?.trim() || null;
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
  const contentLocation =
    res.headers.get("content-location") ??
    res.headers.get("Content-Location");
  const recordIdHint =
    recordIdFromHttpLocationHeader(location) ??
    recordIdFromHttpLocationHeader(contentLocation);
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
  return { row, location, recordIdHint, rawBody: text || null };
}

/** レコード更新 PUT /api/apps/{appsId}/records/{recordId} */
export async function updateRecord(
  appsId: string,
  recordId: string,
  record: Record<string, unknown>,
  auth?: AtPocketFetchAuth,
): Promise<void> {
  const url = `${baseUrl()}/api/apps/${appsId}/records/${encodeURIComponent(recordId)}`;
  const key = resolvePassedApiKey(auth);
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
