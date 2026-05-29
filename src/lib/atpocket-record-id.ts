import type { AtPocketCreateRecordResult, AtPocketFetchAuth, AtPocketRecordRow } from "@/lib/atpocket";
import { fetchRecordById, fetchRecordsList } from "@/lib/atpocket";
import { pickRecordValueByFieldAliases } from "@/lib/calendar-kojo";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Netlify 等のサーバーレス（約10秒制限）向け。長い待機はタイムアウト→「登録に失敗しました」になる */
/** 1回の照合で @pocket 一覧 API を最大3回まで（Netlify 10秒制限対策） */
const POST_CREATE_LOOKUP_DELAYS_MS = [0, 800] as const;
const POST_CREATE_TNUMBER_POLL_DELAYS_MS = [0, 500, 1200] as const;
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
  return raw
    .normalize("NFKC")
    .replace(/[\s\u3000\u00a0\u2000-\u200b\uFEFF]+/g, " ")
    .trim();
}

function compactNameKey(raw: string): string {
  return normalizeMatchText(raw).replace(/\s/g, "");
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

/** 登録直後の一覧照合: 表記ゆれ（全角スペース・空白差）を許容 */
function nameMatchesLoose(got: string, want: string): boolean {
  const a = normalizeMatchText(got);
  const b = normalizeMatchText(want);
  if (!a || !b) return false;
  if (a === b) return true;
  const ac = compactNameKey(a);
  const bc = compactNameKey(b);
  if (ac.length >= 2 && bc.length >= 2 && ac === bc) return true;
  if (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a))) {
    return true;
  }
  return false;
}

function nameAppearsInRecordObject(
  recObj: Record<string, unknown>,
  wantName: string,
): boolean {
  for (const v of Object.values(recObj)) {
    const s = coercePlainString(v);
    if (s && nameMatchesLoose(s, wantName)) return true;
  }
  return false;
}

/** @pocket 一覧の query はフィールド式のみ（自由テキスト不可） */
function escapePocketQueryValue(val: string): string {
  return val.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildFieldEqualsQuery(fieldId: string, value: string): string {
  const id = fieldId.trim();
  const v = escapePocketQueryValue(normalizeMatchText(value));
  if (!id || !v) return "";
  return `(${id} = "${v}")`;
}

/** 全角スペース等の表記差向け（@pocket 保存値が正規化前のとき） */
function buildFieldEqualsQueryVariants(
  fieldId: string,
  value: string,
): string[] {
  const out: string[] = [];
  const normalized = buildFieldEqualsQuery(fieldId, value);
  if (normalized) out.push(normalized);
  const id = fieldId.trim();
  const raw = value.trim();
  if (!id || !raw) return out;
  const norm = normalizeMatchText(value);
  if (raw !== norm) {
    const rawQ = `(${id} = "${escapePocketQueryValue(raw)}")`;
    if (!out.includes(rawQ)) out.push(rawQ);
  }
  return out;
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

export type PostCreateLookupOptions = {
  /** ページ走査の上限（未指定時は env または 2） */
  maxPages?: number;
  /** true のとき全フィールド1ページ照合を省略（タイムアウト抑制） */
  skipFullFieldScan?: boolean;
};

function recordIdFromCreateRawBody(
  createResult: AtPocketCreateRecordResult,
): string | null {
  const raw = createResult.rawBody?.trim();
  if (!raw) return null;
  try {
    const id = atPocketRecordIdFromCreateResponse(
      JSON.parse(raw) as Record<string, unknown>,
      createResult.location,
    );
    if (id) return id;
  } catch {
    /* 非 JSON 応答 */
  }
  const m = raw.match(/\/records\/(\d+)(?:\/|$|[?#])/i);
  return m?.[1]?.trim() || null;
}

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

export async function findConstructionRecordByNewEntryOnce(
  calAppId: string,
  opts: ConstructionLookupOpts,
  auth: AtPocketFetchAuth,
  lookupOpts?: PostCreateLookupOptions,
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
      let name = coercePlainString(
        pickRecordValueByFieldAliases(recObj, opts.customerFieldId),
      );
      if (
        !nameMatchesLoose(name, wantName) &&
        !nameAppearsInRecordObject(recObj, wantName)
      ) {
        continue;
      }
      if (!name) name = wantName;

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
      if (rid && n > newestNameMatchNumeric) {
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

  const finishIfMatched = (): ConstructionRecordMatch | null => {
    if (newestNameMatchId) {
      return {
        recordId: newestNameMatchId,
        uniqueKey: newestNameMatchKey,
      };
    }
    if (bestScore >= 12 && (bestId || bestKey)) {
      return { recordId: bestId, uniqueKey: bestKey };
    }
    return null;
  };

  let fieldQueryAttempted = false;

  /** 一覧の先頭ページだけでは新規行に届かないため、お客様名列のフィールド式で直接絞る */
  for (const nameQuery of buildFieldEqualsQueryVariants(
    opts.customerFieldId,
    wantName,
  )) {
    fieldQueryAttempted = true;
    try {
      const byNameField = await fetchRecordsList(
        calAppId,
        {
          limit: "100",
          page: "1",
          fields: fieldsCsv,
          query: nameQuery,
        },
        auth,
        listOpts,
        { maxRetries: 0 },
      );
      considerRows(byNameField.records ?? []);
      const hit = finishIfMatched();
      if (hit) return hit;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("400") || msg.includes("Bad Request")) continue;
      throw e;
    }
  }

  const maxPages = Math.min(
    10,
    Math.max(
      1,
      lookupOpts?.maxPages ??
        (Number(process.env.CALENDAR_POST_CREATE_LOOKUP_MAX_PAGES) || 2),
    ),
  );

  const pageScanCap = fieldQueryAttempted ? Math.min(maxPages, 1) : maxPages;
  for (let page = 1; page <= pageScanCap; page++) {
    const data = await fetchRecordsList(
      calAppId,
      {
        limit: "200",
        page: String(page),
        fields: fieldsCsv,
      },
      auth,
      listOpts,
    );
    considerRows(data.records ?? []);
    const hit = finishIfMatched();
    if (hit) return hit;
    if (bestScore >= 35 && (bestId || bestKey)) {
      return { recordId: bestId, uniqueKey: bestKey };
    }
    if ((data.records?.length ?? 0) < 200) break;
  }

  if (!lookupOpts?.skipFullFieldScan && !fieldQueryAttempted) {
    const fullFieldsFirst = await fetchRecordsList(
      calAppId,
      { limit: "80", page: "1" },
      auth,
      listOpts,
    );
    considerRows(fullFieldsFirst.records ?? []);
    const fullHit = finishIfMatched();
    if (fullHit) return fullHit;
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

  const fieldQuery = buildFieldEqualsQuery(fieldId, want);
  if (fieldQuery) {
    const qHit = await scanPage(1, fieldQuery);
    if (typeof qHit === "string" && qHit !== "end") return qHit;
  }

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
    last = await findConstructionRecordByNewEntryOnce(calAppId, opts, auth, {
      skipFullFieldScan: true,
    });
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
/** 登録 POST 直後に工事レコード ID / T番号を解決（@pocket 呼び出し回数を抑える） */
export async function resolveConstructionRecordAfterCreate(
  calAppId: string,
  createResult: AtPocketCreateRecordResult,
  lookup: ConstructionLookupOpts,
  auth: AtPocketFetchAuth,
  _fallbackAuth?: AtPocketFetchAuth,
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

  let recordId =
    atPocketRecordIdFromCreateResult(createResult) ??
    recordIdFromCreateRawBody(createResult);
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

  return { recordId, uniqueKey };
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
