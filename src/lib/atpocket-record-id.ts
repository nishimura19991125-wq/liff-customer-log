import type { AtPocketCreateRecordResult, AtPocketFetchAuth, AtPocketRecordRow } from "@/lib/atpocket";
import { fetchRecordsList } from "@/lib/atpocket";
import { pickRecordValueByFieldAliases } from "@/lib/calendar-kojo";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  for (const key of ["data", "result"]) {
    const nested = o[key];
    if (nested && typeof nested === "object") {
      const id = atPocketRecordIdFromCreateResponse(
        nested as Record<string, unknown>,
      );
      if (id) return id;
    }
  }

  return null;
}

export function atPocketRecordIdFromCreateResult(
  result: AtPocketCreateRecordResult,
): string | null {
  return (
    atPocketRecordIdFromCreateResponse(result.row, result.location) ??
    atPocketRecordIdFromRow(result.row)
  );
}

type ConstructionLookupOpts = {
  customerName: string;
  housingStatus: string;
  customerFieldId: string;
  housingFieldId: string;
  startDateFieldId?: string;
  tNumberFieldId?: string;
};

async function findConstructionRecordIdByNewEntryOnce(
  calAppId: string,
  opts: ConstructionLookupOpts,
  auth: AtPocketFetchAuth,
): Promise<string | null> {
  const wantName = opts.customerName.trim();
  const wantHousing = opts.housingStatus.trim();
  if (!wantName || !wantHousing) return null;

  const fieldParts = [
    opts.customerFieldId,
    opts.housingFieldId,
    opts.startDateFieldId,
    opts.tNumberFieldId,
  ].filter((id, i, arr) => id && arr.indexOf(id) === i);
  const fieldsCsv = fieldParts.join(",");

  const recentCutoff = Date.now() - 5 * 60 * 1000;
  let bestId: string | null = null;
  let bestScore = -1;
  let bestNumeric = -1;

  const considerRows = (rows: AtPocketRecordRow[]) => {
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

      let score = 10;
      if (housingMatches(housing, wantHousing)) {
        score += 30;
      } else if (housing.trim()) {
        continue;
      }

      if (opts.startDateFieldId && !startRaw.trim()) score += 8;
      if (tNum.trim()) score += 5;

      const ts = rowTimestampMs(row);
      if (ts >= recentCutoff) score += 15;

      const rid = atPocketRecordIdFromRow(row);
      if (!rid) continue;
      const n = recordIdNumeric(rid);
      if (score > bestScore || (score === bestScore && n > bestNumeric)) {
        bestScore = score;
        bestNumeric = n;
        bestId = rid;
      }
    }
  };

  const listOpts = {
    operation: "calendar:新規登録後のrecordId照合",
    appEnv: "CALENDAR_APP_ID",
  } as const;

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
    if (bestScore >= 38) return bestId;
    if (rows.length < 200) break;
  }

  const data = await fetchRecordsList(
    calAppId,
    { limit: "300", page: "1", fields: fieldsCsv },
    auth,
    listOpts,
  );
  considerRows(data.records ?? []);
  return bestScore >= 18 ? bestId : null;
}

/**
 * 登録 API が ID を返さないとき、お客様名・住宅ステータス等で直近レコードを照合する（リトライ付き）。
 */
export async function findConstructionRecordIdByNewEntry(
  calAppId: string,
  opts: ConstructionLookupOpts,
  auth: AtPocketFetchAuth,
): Promise<string | null> {
  const delays = [0, 350, 900, 1800];
  let last: string | null = null;
  for (const delay of delays) {
    if (delay > 0) await sleep(delay);
    last = await findConstructionRecordIdByNewEntryOnce(calAppId, opts, auth);
    if (last) return last;
  }
  return last;
}

/** 工事登録 POST 直後に recordId を可能な限り解決する */
export async function resolveConstructionRecordIdAfterCreate(
  calAppId: string,
  createResult: AtPocketCreateRecordResult,
  lookup: ConstructionLookupOpts,
  auth: AtPocketFetchAuth,
): Promise<string | null> {
  const fromCreate = atPocketRecordIdFromCreateResult(createResult);
  if (fromCreate) return fromCreate;
  return findConstructionRecordIdByNewEntry(calAppId, lookup, auth);
}
