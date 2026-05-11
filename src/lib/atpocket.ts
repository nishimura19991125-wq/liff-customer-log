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

export type AtPocketFetchAuth = {
  apiKey?: string;
};

/** ログアプリ（LOG_APP_ID）へのレコード登録用。未設定時は担当者マスタと同じ ATPOCKET_API_KEY */
function apiKeyForCreateRecord(appsId: string): string {
  const logAppId = process.env.LOG_APP_ID?.trim();
  const logKey = process.env.LOG_ATPOCKET_API_KEY?.trim();
  if (logAppId && appsId === logAppId && logKey) {
    return logKey;
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

/** @pocket docs: auth key header is tied to POST; use override for GET semantics */
export async function fetchRecordsList(
  appsId: string,
  searchParams?: { limit?: string; page?: string; fields?: string },
  auth?: AtPocketFetchAuth,
): Promise<AtPocketListResponse> {
  const params = new URLSearchParams();
  params.set("limit", searchParams?.limit ?? "1000");
  if (searchParams?.page) params.set("page", searchParams.page);
  if (searchParams?.fields) params.set("fields", searchParams.fields);
  const qs = params.toString();
  const path = `/api/apps/${appsId}/records${qs ? `?${qs}` : ""}`;

  const res = await fetchWithMethodOverride(path, auth);

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`@pocket list records failed: ${res.status} ${text}`);
  }
  return text ? (JSON.parse(text) as AtPocketListResponse) : { records: [] };
}

/** アプリのフィールド定義一覧 GET /api/apps/{appsId}/fields */
export async function fetchAppFields(
  appsId: string,
  auth?: AtPocketFetchAuth,
): Promise<AtPocketFieldRow[]> {
  const params = new URLSearchParams();
  params.set("limit", "1000");
  params.set("page", "1");
  const path = `/api/apps/${appsId}/fields?${params.toString()}`;
  const res = await fetchWithMethodOverride(path, auth);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`@pocket list fields failed: ${res.status} ${text}`);
  }
  if (!text) return [];
  const json = JSON.parse(text) as { fields?: AtPocketFieldRow[] };
  return json.fields ?? [];
}

const CALENDAR_PAGE_LIMIT = 1000;
const CALENDAR_MAX_PAGES = 200;

/** @pocket 一覧をページングで全件取得（工事カレンダーなど） */
export async function fetchAllRecordsPages(
  appsId: string,
  fieldsCsv: string,
  auth?: AtPocketFetchAuth,
): Promise<AtPocketRecordRow[]> {
  const all: AtPocketRecordRow[] = [];
  for (let page = 1; page <= CALENDAR_MAX_PAGES; page++) {
    const data = await fetchRecordsList(
      appsId,
      {
        limit: String(CALENDAR_PAGE_LIMIT),
        page: String(page),
        fields: fieldsCsv,
      },
      auth,
    );
    const recs = data.records ?? [];
    all.push(...recs);
    if (recs.length < CALENDAR_PAGE_LIMIT) break;
  }
  return all;
}

/** 単一レコード GET /api/apps/{appsId}/records/{recordId} */
export async function fetchRecordById(
  appsId: string,
  recordId: string,
  auth?: AtPocketFetchAuth,
): Promise<AtPocketRecordRow | null> {
  const path = `/api/apps/${appsId}/records/${encodeURIComponent(recordId)}`;
  const res = await fetchWithMethodOverride(path, auth);
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
