import "server-only";

export type AtPocketRecordRow = {
  recordId?: number;
  id?: number;
  uniqueId?: string;
  record?: Record<string, unknown>;
  /** 一覧 API が返す編集画面への URL（環境により付与） */
  accessEditUrl?: string;
};

export type AtPocketListResponse = {
  records?: AtPocketRecordRow[];
};

export type AtPocketFieldRow = {
  uniqueId?: string;
  caption?: string;
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

/** スタッフ名簿アプリの LINE 紐付け更新用（未設定時は ATPOCKET_API_KEY・書き込み権限が必要） */
export function apiKeyForStaffWrite(): string {
  const w = process.env.STAFF_WRITE_ATPOCKET_API_KEY?.trim();
  if (w) return w;
  return apiKey();
}

export type AtPocketFetchAuth = {
  apiKey?: string;
};

/** ログアプリ・工事カレンダーアプリへのレコード登録用キー */
function apiKeyForCreateRecord(appsId: string): string {
  const logAppId = process.env.LOG_APP_ID?.trim();
  const logKey = process.env.LOG_ATPOCKET_API_KEY?.trim();
  if (logAppId && appsId === logAppId && logKey) {
    return logKey;
  }
  const calAppId = process.env.CALENDAR_APP_ID?.trim();
  if (calAppId && appsId === calAppId) {
    return apiKeyForCalendarPocket();
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

/** 429 のとき指数バックオフで再試行（429 応答は本文を読み捨て済みであること） */
async function fetchWithMethodOverrideWithRetry(
  pathWithQuery: string,
  auth?: AtPocketFetchAuth,
): Promise<Response> {
  let last: Response | undefined;
  for (let attempt = 0; attempt < POCKET_GET_RETRY_MAX; attempt++) {
    const res = await fetchWithMethodOverride(pathWithQuery, auth);
    last = res;
    if (res.status !== 429) return res;
    if (attempt === POCKET_GET_RETRY_MAX - 1) return res;
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
): Promise<AtPocketListResponse> {
  const params = new URLSearchParams();
  params.set("limit", searchParams?.limit ?? "1000");
  if (searchParams?.page) params.set("page", searchParams.page);
  if (searchParams?.fields) params.set("fields", searchParams.fields);
  if (searchParams?.query) params.set("query", searchParams.query);
  const qs = params.toString();
  const path = `/api/apps/${appsId}/records${qs ? `?${qs}` : ""}`;

  const res = await fetchWithMethodOverrideWithRetry(path, auth);

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`@pocket list records failed: ${res.status} ${text}`);
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
): Promise<AtPocketFieldRow[]> {
  const params = new URLSearchParams();
  params.set("limit", "1000");
  params.set("page", "1");
  const path = `/api/apps/${appsId}/fields?${params.toString()}`;
  const res = await fetchWithMethodOverrideWithRetry(path, auth);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`@pocket list fields failed: ${res.status} ${text}`);
  }
  if (!text) return [];
  const json = JSON.parse(text) as { fields?: AtPocketFieldRow[] };
  return json.fields ?? [];
}

export async function fetchAppFields(
  appsId: string,
  auth?: AtPocketFetchAuth,
): Promise<AtPocketFieldRow[]> {
  const key = appsId.trim();
  const now = Date.now();
  const hit = appFieldsStore.get(key);
  if (hit && hit.expiresAt > now) return hit.fields;

  const pending = appFieldsInflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const fields = await fetchAppFieldsOnce(appsId, auth);
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

const CALENDAR_PAGE_LIMIT = 1000;
const CALENDAR_MAX_PAGES = 200;

/** @pocket 一覧をページングで全件取得（工事カレンダーなど） */
export async function fetchAllRecordsPages(
  appsId: string,
  fieldsCsv: string,
  auth?: AtPocketFetchAuth,
  pocketQuery?: string | null,
): Promise<AtPocketRecordRow[]> {
  const all: AtPocketRecordRow[] = [];
  for (let page = 1; page <= CALENDAR_MAX_PAGES; page++) {
    const data = await fetchRecordsList(
      appsId,
      {
        limit: String(CALENDAR_PAGE_LIMIT),
        page: String(page),
        fields: fieldsCsv,
        ...(pocketQuery?.trim() ? { query: pocketQuery.trim() } : {}),
      },
      auth,
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
): Promise<void> {
  const url = `${baseUrl()}/api/apps/${appsId}/records`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      [authHeaderName()]: apiKeyForCreateRecord(appsId),
    },
    body: JSON.stringify({ record }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`@pocket create record failed: ${res.status} ${text}`);
  }
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
