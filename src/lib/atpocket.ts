export type AtPocketRecordRow = {
  recordId?: number;
  uniqueId?: string;
  record?: Record<string, unknown>;
};

export type AtPocketListResponse = {
  records?: AtPocketRecordRow[];
};

export type AtPocketField = {
  fieldId?: number;
  parentFieldId?: number;
  caption?: string;
  uniqueId?: string;
  subTable?: AtPocketField[];
};

export type AtPocketFieldsResponse = {
  fields?: AtPocketField[];
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

async function fetchWithMethodOverride(
  pathWithQuery: string,
): Promise<Response> {
  const url = `${baseUrl()}${pathWithQuery}`;
  return fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      [authHeaderName()]: apiKey(),
      "X-HTTP-Method-Override": "GET",
    },
  });
}

/** @pocket docs: auth key header is tied to POST; use override for GET semantics */
export async function fetchFieldsList(
  appsId: string,
  searchParams?: { limit?: string; page?: string; name?: string },
): Promise<AtPocketFieldsResponse> {
  const params = new URLSearchParams();
  params.set("limit", searchParams?.limit ?? "1000");
  if (searchParams?.page) params.set("page", searchParams.page);
  if (searchParams?.name) params.set("name", searchParams.name);
  const qs = params.toString();
  const path = `/api/apps/${appsId}/fields${qs ? `?${qs}` : ""}`;

  const res = await fetchWithMethodOverride(path);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`@pocket list fields failed: ${res.status} ${text}`);
  }
  return text ? (JSON.parse(text) as AtPocketFieldsResponse) : { fields: [] };
}

function flattenFields(fields: AtPocketField[]): AtPocketField[] {
  const out: AtPocketField[] = [];
  for (const f of fields) {
    out.push(f);
    if (f.subTable?.length) {
      out.push(...flattenFields(f.subTable));
    }
  }
  return out;
}

/** 見出し（caption）が一致するフィールドの Web API 用キー（uniqueId）を返す */
export function resolveUniqueIdByCaption(
  fieldsRoot: AtPocketField[],
  captionLabel: string,
): string {
  const target = captionLabel.trim();
  if (!target) {
    throw new Error("Caption label is empty");
  }
  const flat = flattenFields(fieldsRoot);
  const hits = flat.filter((f) => (f.caption ?? "").trim() === target);
  if (hits.length === 0) {
    throw new Error(`見出しが "${target}" のフィールドが見つかりません`);
  }
  if (hits.length > 1) {
    throw new Error(`見出し "${target}" が複数のフィールドで重複しています`);
  }
  const uid = hits[0].uniqueId?.trim();
  if (!uid) {
    throw new Error(`見出し "${target}" のフィールドに uniqueId がありません`);
  }
  return uid;
}

/** @pocket docs: auth key header is tied to POST; use override for GET semantics */
export async function fetchRecordsList(
  appsId: string,
  searchParams?: { limit?: string; page?: string; fields?: string },
): Promise<AtPocketListResponse> {
  const params = new URLSearchParams();
  params.set("limit", searchParams?.limit ?? "1000");
  if (searchParams?.page) params.set("page", searchParams.page);
  if (searchParams?.fields) params.set("fields", searchParams.fields);
  const qs = params.toString();
  const path = `/api/apps/${appsId}/records${qs ? `?${qs}` : ""}`;

  const res = await fetchWithMethodOverride(path);

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`@pocket list records failed: ${res.status} ${text}`);
  }
  return text ? (JSON.parse(text) as AtPocketListResponse) : { records: [] };
}

/** 単一レコード取得 GET /api/apps/{appsId}/records/{recordId} */
export async function fetchRecordById(
  appsId: string,
  recordId: string,
): Promise<AtPocketRecordRow | null> {
  const path = `/api/apps/${appsId}/records/${encodeURIComponent(recordId)}`;
  const res = await fetchWithMethodOverride(path);
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
      [authHeaderName()]: apiKey(),
    },
    body: JSON.stringify({ record }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`@pocket create record failed: ${res.status} ${text}`);
  }
}
