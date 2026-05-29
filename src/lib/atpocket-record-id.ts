import type { AtPocketCreateRecordResult, AtPocketFetchAuth, AtPocketRecordRow } from "@/lib/atpocket";
import { fetchRecordById, fetchRecordsList } from "@/lib/atpocket";
import { pickRecordValueByFieldAliases } from "@/lib/calendar-kojo";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Netlify 等のサーバーレス（約10秒制限）向け。長い待機はタイムアウト→「登録に失敗しました」になる */
const POST_CREATE_LOOKUP_DELAYS_MS = [0, 400, 1200, 2500] as const;
const POST_CREATE_TNUMBER_POLL_DELAYS_MS = [0, 500, 1200, 2500] as const;
export const SYNC_TNUMBER_POLL_DELAYS_MS = [0, 400, 1200] as const;

/** accessEditUrl / Location からレコード ID を抽出（…/records/123/edit 等） */
export function recordIdFromAccessEditUrl(url: string): string | null {
  const s = url.trim();
  if (!s) return null;
  const m =
    s.match(/\/records\/(\d+)(?:\/|$|[?#])/i) ||
    s.match(/\/record\/(\d+)(?:\/|$|[?#])/i);
  const id = m?.[1]?.trim();
  return id || null;
}

function recordIdFromLocationHeader(location: string): string | null {
  const s = location.trim();
  if (!s) return null;
  return recordIdFromAccessEditUrl(s) ?? recordIdFromAccessEditUrl(`https://x${s.startsWith("/") ? "" : "/"}${s}`);
}

function normalizeMatchText(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function coercePlainString(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw).trim();
  }
  if (Array.isArray(raw)) {
    return raw.map(coercePlainString).filter(Boolean).join(" ");
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const k of ["value", "displayValue", "label", "name", "text"]) {
      const v = o[k];
      if (v != null && (typeof v === "string" || typeof v === "number")) {
        return String(v).trim();
      }
    }
  }
  return String(raw).trim();
}

function nameMatches(got: string, want: string): boolean {
  return normalizeMatchText(got) === normalizeMatchText(want);
}

function housingMatches(got: string, want: string): boolean {
  const a = normalizeMatchText(got);
  const b = normalizeMatchText(want);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function tNumberKeysMatch(cellValue: string, wantKey: string): boolean {
  const a = normalizeMatchText(cellValue);
  const b = normalizeMatchText(wantKey);
  return Boolean(a && b && a === b);
}

function rowTimestampMs(row: AtPocketRecordRow): number {
  for (const raw of [row.updatedAt, row.createdAt]) {
    if (!raw) continue;
    const t = Date.parse(String(raw));
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

function recordIdNumeric(id: string): number {
  const n = Number(id);
  return Number.isFinite(n) ? n : -1;
}

/** @pocket のレコード行から API 用 recordId（なければ uniqueId）を得る */
export function atPocketRecordIdFromRow(
  row: AtPocketRecordRow | null | undefined,
): string | null {
  if (!row) return null;
  if (row.recordId != null && String(row.recordId).trim()) {
    return String(row.recordId).trim();
  }
  if (row.id != null && String(row.id).trim()) {
    return String(row.id).trim();
  }
  const uid = row.uniqueId?.trim();
  if (uid) return uid;

  if (row.accessEditUrl) {
    const fromUrl = recordIdFromAccessEditUrl(String(row.accessEditUrl));
    if (fromUrl) return fromUrl;
  }

  const rec = row.record;
  if (rec && typeof rec === "object") {
    const inner = rec as Record<string, unknown>;
    if (inner.recordId != null && String(inner.recordId).trim()) {
      return String(inner.recordId).trim();
    }
    if (inner.id != null && String(inner.id).trim()) {
      return String(inner.id).trim();
    }
  }

  return null;
}

/**
 * POST /records の応答から recordId を得る。
 * 空ボディ・records 配列・accessEditUrl のみ、などの揺れに対応。
 */
export function atPocketRecordIdFromCreateResponse(
  body: AtPocketRecordRow | Record<string, unknown> | null | undefined,
  locationHint?: string | null,
): string | null {
  if (locationHint) {
    const fromLoc = recordIdFromLocationHeader(locationHint);
    if (fromLoc) return fromLoc;
  }

  if (!body || typeof body !== "object") return null;

  const direct = atPocketRecordIdFromRow(body as AtPocketRecordRow);
  if (direct) return direct;

  const o = body as Record<string, unknown>;

  const records = o.records;
  if (Array.isArray(records)) {
    for (const item of records) {
      const id = atPocketRecordIdFromRow(item as AtPocketRecordRow);
      if (id) return id;
    }
  }

  const accessUrl = o.accessUrl ?? o.accessEditUrl;
  if (typeof accessUrl === "string") {
    const fromUrl = recordIdFromAccessEditUrl(accessUrl);
    if (fromUrl) return fromUrl;
  }

  const rec = o.record;
  if (rec && typeof rec === "object") {
    const nested = atPocketRecordIdFromRow({ record: rec } as AtPocketRecordRow);
    if (nested) return nested;
  }

  for (const key of ["data", "result", "recordData"]) {
    const nested = o[key];
    if (nested && typeof nested === "object") {
      const id = atPocketRecordIdFromCreateResponse(
        nested as Record<string, unknown>,
      );
      if (id) return id;
    }
  }

  for (const key of ["recordId", "record_id", "id", "insertId"]) {
    const v = o[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }

  return null;
}

export function atPocketRecordIdFromCreateResult(
  result: AtPocketCreateRecordResult,
): string | null {
  const hint = result.recordIdHint?.trim();
  if (hint) return hint;
  return (
    atPocketRecordIdFromCreateResponse(result.row, result.location) ??
    atPocketRecordIdFromRow(result.row)
  );
}

export type ConstructionLookupOpts = {
  customerName: string;
  housingStatus: string;
  customerFieldId: string;
  housingFieldId: string;
  startDateFieldId?: string;
  tNumberFieldId?: string;
};

export type ConstructionRecordMatch = {
  recordId: string | null;
  uniqueKey: string | null;
};

function uniqueKeyFromPocketRow(
  row: AtPocketRecordRow | Record<string, unknown> | null | undefined,
  tNumberFieldId: string | undefined,
): string | null {
  if (!tNumberFieldId?.trim() || !row || typeof row !== "object") return null;
  const rec =
    "record" in row && row.record && typeof row.record === "object"
      ? (row.record as Record<string, unknown>)
      : (row as Record<string, unknown>);
  const key = coercePlainString(
    pickRecordValueByFieldAliases(rec, tNumberFieldId),
  );
  return key || null;
}

/** 自動採番直後は T番号が空のことがあるため、GET で反映を待つ */
export async function pollConstructionTNumberByRecordId(
  calAppId: string,
  recordId: string,
  tNumberFieldId: string,
  auth: AtPocketFetchAuth,
  fieldsCsv?: string,
  pollDelaysMs: readonly number[] = POST_CREATE_TNUMBER_POLL_DELAYS_MS,
): Promise<string | null> {
  const csv = fieldsCsv?.trim() || tNumberFieldId;
  for (const delay of pollDelaysMs) {
    if (delay > 0) await sleep(delay);
    let row: Awaited<ReturnType<typeof fetchRecordById>> = null;
    try {
      row = await fetchRecordById(calAppId, recordId, auth, csv);
      if (!row?.record) {
        row = await fetchRecordById(calAppId, recordId, auth);
      }
    } catch {
      continue;
    }
    const key = uniqueKeyFromPocketRow(row, tNumberFieldId);
    if (key) return key;
  }
  return null;
}

async function findConstructionRecordByNewEntryOnce(
  calAppId: string,
  opts: ConstructionLookupOpts,
  auth: AtPocketFetchAuth,
): Promise<ConstructionRecordMatch> {
  const wantName = opts.customerName.trim();
  const wantHousing = opts.housingStatus.trim();
  if (!wantName || !wantHousing) {
    return { recordId: null, uniqueKey: null };
  }

  const fieldParts = [
    opts.customerFieldId,
    opts.housingFieldId,
    opts.startDateFieldId,
    opts.tNumberFieldId,
  ].filter((id, i, arr) => id && arr.indexOf(id) === i);
  const fieldsCsv = fieldParts.join(",");

  const recentCutoff = Date.now() - 15 * 60 * 1000;
  let bestId: string | null = null;
  let bestKey: string | null = null;
  let bestScore = -1;
  let bestNumeric = -1;
  /** お客様名一致のうち recordId が最大の行（登録直後で T番号未反映でも ID 特定用） */
  let newestNameMatchId: string | null = null;
  let newestNameMatchNumeric = -1;
  let newestNameMatchKey: string | null = null;

  const considerRows = (rows: AtPocketRecordRow[], nameOnly = false) => {
    for (const row of rows) {
      const rec = row.record;
      if (!rec || typeof rec !== "object") continue;
      const recObj = rec as Record<string, unknown>;
      const name = coercePlainString(
        pickRecordValueByFieldAliases(recObj, opts.customerFieldId),
      );
      if (!nameMatches(name, wantName)) continue;

      const housing = coercePlainString(
        pickRecordValueByFieldAliases(recObj, opts.housingFieldId),
      );
      const startRaw = opts.startDateFieldId
        ? coercePlainString(
            pickRecordValueByFieldAliases(recObj, opts.startDateFieldId),
          )
        : "";
      const tNum = opts.tNumberFieldId
        ? coercePlainString(
            pickRecordValueByFieldAliases(recObj, opts.tNumberFieldId),
          )
        : "";

      const rid = atPocketRecordIdFromRow(row);
      const n = rid ? recordIdNumeric(rid) : -1;
      const ts = rowTimestampMs(row);
      /** 登録直後は createdAt が無いことがあるため、お客様名一致なら最大 recordId を採用 */
      if (n > newestNameMatchNumeric) {
        newestNameMatchNumeric = n;
        newestNameMatchId = rid;
        newestNameMatchKey = tNum.trim() || newestNameMatchKey;
      }

      let score = 10;
      if (!nameOnly) {
        if (housingMatches(housing, wantHousing)) {
          score += 30;
        } else if (housing.trim()) {
          continue;
        }
        if (opts.startDateFieldId && !startRaw.trim()) score += 8;
      }
      if (tNum.trim()) score += 12;

      if (ts >= recentCutoff) score += 15;

      if (score > bestScore || (score === bestScore && n > bestNumeric)) {
        bestScore = score;
        bestNumeric = n;
        bestId = rid || bestId;
        bestKey = tNum.trim() || bestKey;
      }
    }
  };

  const listOpts = {
    operation: "calendar:新規登録後のrecordId照合",
    appEnv: "CALENDAR_APP_ID",
  } as const;

  const byName = await fetchRecordsList(
    calAppId,
    { limit: "100", page: "1", fields: fieldsCsv, query: wantName },
    auth,
    listOpts,
  );
  considerRows(byName.records ?? []);
  if (newestNameMatchId) {
    return {
      recordId: newestNameMatchId,
      uniqueKey: newestNameMatchKey,
    };
  }
  if (bestScore >= 35 && (bestId || bestKey)) {
    return { recordId: bestId, uniqueKey: bestKey };
  }

  const recent = await fetchRecordsList(
    calAppId,
    { limit: "200", page: "1", fields: fieldsCsv },
    auth,
    listOpts,
  );
  considerRows(recent.records ?? []);
  if (bestScore >= 35 && (bestId || bestKey)) {
    return { recordId: bestId, uniqueKey: bestKey };
  }
  if (newestNameMatchId) {
    return {
      recordId: newestNameMatchId,
      uniqueKey: newestNameMatchKey,
    };
  }

  for (let page = 1; page <= 5; page++) {
    const data = await fetchRecordsList(
      calAppId,
      {
        limit: "200",
        page: String(page),
        fields: fieldsCsv,
        query: wantName,
      },
      auth,
      listOpts,
    );
    const rows = data.records ?? [];
    considerRows(rows);
    if (bestScore >= 35 && (bestId || bestKey)) {
      return { recordId: bestId, uniqueKey: bestKey };
    }
    if (rows.length < 200) break;
  }

  considerRows(recent.records ?? [], true);
  if (bestScore >= 12 && (bestId || bestKey)) {
    return { recordId: bestId, uniqueKey: bestKey };
  }

  if (newestNameMatchId) {
    return {
      recordId: newestNameMatchId,
      uniqueKey: newestNameMatchKey,
    };
  }

  return { recordId: bestId, uniqueKey: bestKey };
}

/**
 * 工事アプリで T番号（取込キー）が一致するレコード ID を返す。お客様情報のキー照合と同様の考え方。
 */
export async function findConstructionRecordIdByTNumber(
  calAppId: string,
  tNumberFieldId: string,
  tNumber: string,
  auth: AtPocketFetchAuth,
): Promise<string | null> {
  const want = normalizeMatchText(tNumber);
  const fieldId = tNumberFieldId.trim();
  if (!want || !fieldId) return null;

  const listOpts = {
    operation: "calendar:工事アプリT番号照合",
    appEnv: "CALENDAR_APP_ID",
  } as const;

  const scanPage = async (
    page: number,
    query?: string,
  ): Promise<string | null | "end"> => {
    const data = await fetchRecordsList(
      calAppId,
      {
        limit: "500",
        page: String(page),
        fields: fieldId,
        ...(query ? { query } : {}),
      },
      auth,
      listOpts,
    );
    for (const row of data.records ?? []) {
      const rec = row.record;
      if (!rec || typeof rec !== "object") continue;
      const cell = coercePlainString(
        pickRecordValueByFieldAliases(rec as Record<string, unknown>, fieldId),
      );
      if (!tNumberKeysMatch(cell, want)) continue;
      const id = atPocketRecordIdFromRow(row);
      if (id) return id;
    }
    return (data.records?.length ?? 0) < 500 ? "end" : null;
  };

  const qHit = await scanPage(1, want);
  if (typeof qHit === "string" && qHit !== "end") return qHit;

  for (let page = 1; page <= 15; page++) {
    const hit = await scanPage(page);
    if (typeof hit === "string") {
      if (hit === "end") return null;
      return hit;
    }
  }
  return null;
}

/** T番号が分かれば工事レコード ID を検索で解決（登録 API の ID に依存しない） */
export async function resolveConstructionRecordIdByTNumber(
  calAppId: string,
  tNumber: string,
  tNumberFieldId: string,
  auth: AtPocketFetchAuth,
): Promise<string | null> {
  const delays = [0, 400, 1000, 2000, 3500];
  for (const delay of delays) {
    if (delay > 0) await sleep(delay);
    const id = await findConstructionRecordIdByTNumber(
      calAppId,
      tNumberFieldId,
      tNumber,
      auth,
    );
    if (id) return id;
  }
  return null;
}

/**
 * 登録 API が ID を返さないとき、お客様名・住宅ステータス等で直近レコードを照合する（リトライ付き）。
 */
export async function findConstructionRecordByNewEntry(
  calAppId: string,
  opts: ConstructionLookupOpts,
  auth: AtPocketFetchAuth,
): Promise<ConstructionRecordMatch> {
  let last: ConstructionRecordMatch = { recordId: null, uniqueKey: null };
  for (const delay of POST_CREATE_LOOKUP_DELAYS_MS) {
    if (delay > 0) await sleep(delay);
    last = await findConstructionRecordByNewEntryOnce(calAppId, opts, auth);
    if (last.recordId && last.uniqueKey) return last;
    if (last.recordId) return last;
    if (last.uniqueKey) return last;
  }
  return last;
}

/**
 * 工事登録 POST 直後: 登録レコードを特定し GET で T番号を取得する。
 * 1) recordId（POST 応答 or 一覧照合） 2) GET ポーリングで T番号 3) T番号のみのときは検索で ID
 */
async function resolveConstructionRecordAfterCreateWithAuth(
  calAppId: string,
  createResult: AtPocketCreateRecordResult,
  lookup: ConstructionLookupOpts,
  auth: AtPocketFetchAuth,
): Promise<ConstructionRecordMatch> {
  const tField = lookup.tNumberFieldId?.trim();
  const fieldsCsv = [
    lookup.customerFieldId,
    lookup.housingFieldId,
    lookup.startDateFieldId,
    tField,
  ]
    .filter((id, i, arr) => id && arr.indexOf(id) === i)
    .join(",");

  let recordId = atPocketRecordIdFromCreateResult(createResult);
  let uniqueKey = tField ? uniqueKeyFromPocketRow(createResult.row, tField) : null;

  if (!recordId) {
    const listed = await findConstructionRecordByNewEntry(calAppId, lookup, auth);
    recordId = listed.recordId;
    uniqueKey = uniqueKey ?? listed.uniqueKey;
  }

  if (recordId && !uniqueKey && tField) {
    uniqueKey = await pollConstructionTNumberByRecordId(
      calAppId,
      recordId,
      tField,
      auth,
      fieldsCsv,
    );
  }

  if (!recordId) {
    const once = await findConstructionRecordByNewEntryOnce(
      calAppId,
      lookup,
      auth,
    );
    recordId = once.recordId;
    uniqueKey = uniqueKey ?? once.uniqueKey;
  }

  return { recordId, uniqueKey };
}

/** 登録 POST 直後に工事レコード ID / T番号を解決（一覧・GET は参照キー推奨） */
export async function resolveConstructionRecordAfterCreate(
  calAppId: string,
  createResult: AtPocketCreateRecordResult,
  lookup: ConstructionLookupOpts,
  auth: AtPocketFetchAuth,
  fallbackAuth?: AtPocketFetchAuth,
): Promise<ConstructionRecordMatch> {
  let match = await resolveConstructionRecordAfterCreateWithAuth(
    calAppId,
    createResult,
    lookup,
    auth,
  );
  const fallbackKey = fallbackAuth?.apiKey?.trim();
  const primaryKey = auth.apiKey?.trim();
  if (!match.recordId && fallbackAuth && fallbackKey && fallbackKey !== primaryKey) {
    const alt = await resolveConstructionRecordAfterCreateWithAuth(
      calAppId,
      createResult,
      lookup,
      fallbackAuth,
    );
    if (alt.recordId || alt.uniqueKey) match = alt;
  }
  return match;
}

/** @deprecated resolveConstructionRecordAfterCreate を使用 */
export async function resolveConstructionRecordIdAfterCreate(
  calAppId: string,
  createResult: AtPocketCreateRecordResult,
  lookup: ConstructionLookupOpts,
  auth: AtPocketFetchAuth,
): Promise<string | null> {
  const m = await resolveConstructionRecordAfterCreate(
    calAppId,
    createResult,
    lookup,
    auth,
  );
  return m.recordId;
}
