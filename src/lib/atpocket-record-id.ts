import type { AtPocketFetchAuth, AtPocketRecordRow } from "@/lib/atpocket";
import { fetchRecordsList } from "@/lib/atpocket";
import { pickRecordValueByFieldAliases } from "@/lib/calendar-kojo";

/** accessEditUrl からレコード ID を抽出（…/records/123/edit 等） */
export function recordIdFromAccessEditUrl(url: string): string | null {
  const s = url.trim();
  if (!s) return null;
  const m =
    s.match(/\/records\/(\d+)(?:\/|$|[?#])/i) ||
    s.match(/\/record\/(\d+)(?:\/|$|[?#])/i);
  const id = m?.[1]?.trim();
  return id || null;
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
): string | null {
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

/**
 * 登録 API が ID を返さないとき、お客様名・住宅ステータスで直近レコードを照合する。
 */
export async function findConstructionRecordIdByNewEntry(
  calAppId: string,
  opts: {
    customerName: string;
    housingStatus: string;
    customerFieldId: string;
    housingFieldId: string;
  },
  auth: AtPocketFetchAuth,
): Promise<string | null> {
  const wantName = opts.customerName.trim();
  const wantHousing = opts.housingStatus.trim();
  if (!wantName || !wantHousing) return null;

  const fieldsCsv = [opts.customerFieldId, opts.housingFieldId]
    .filter((id, i, arr) => id && arr.indexOf(id) === i)
    .join(",");

  let bestId: string | null = null;
  let bestNumeric = -1;

  const considerRows = (rows: AtPocketRecordRow[]) => {
    for (const row of rows) {
      const rec = row.record;
      if (!rec || typeof rec !== "object") continue;
      const recObj = rec as Record<string, unknown>;
      const name = coercePlainString(
        pickRecordValueByFieldAliases(recObj, opts.customerFieldId),
      );
      const housing = coercePlainString(
        pickRecordValueByFieldAliases(recObj, opts.housingFieldId),
      );
      if (name !== wantName || housing !== wantHousing) continue;

      const rid = atPocketRecordIdFromRow(row);
      if (!rid) continue;
      const n = Number(rid);
      if (Number.isFinite(n) && n > bestNumeric) {
        bestNumeric = n;
        bestId = rid;
      } else if (!Number.isFinite(n) && !bestId) {
        bestId = rid;
      }
    }
  };

  for (let page = 1; page <= 3; page++) {
    const data = await fetchRecordsList(
      calAppId,
      {
        limit: "200",
        page: String(page),
        fields: fieldsCsv,
        query: wantName,
      },
      auth,
      { operation: "calendar:新規登録後のrecordId照合", appEnv: "CALENDAR_APP_ID" },
    );
    const rows = data.records ?? [];
    considerRows(rows);
    if (bestId) return bestId;
    if (rows.length < 200) break;
  }

  const data = await fetchRecordsList(
    calAppId,
    {
      limit: "200",
      page: "1",
      fields: fieldsCsv,
    },
    auth,
    { operation: "calendar:新規登録後のrecordId照合(全件1ページ)", appEnv: "CALENDAR_APP_ID" },
  );
  considerRows(data.records ?? []);
  return bestId;
}
