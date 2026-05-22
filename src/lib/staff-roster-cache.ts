import "server-only";

import type { AtPocketRecordRow } from "@/lib/atpocket";
import {
  apiKeyForStaffPocketRead,
  fetchAllRecordsPages,
  fetchRecordsList,
} from "@/lib/atpocket";
import {
  staffLineBindingEnabled,
  staffLineUserIdFieldIdsFromEnv,
} from "@/lib/staff-line-field-config";
import { staffRecordMatchesLineUser } from "@/lib/staff-line-binding";

type RosterCacheEntry = {
  expiresAt: number;
  rows: AtPocketRecordRow[];
};

let rosterCache: RosterCacheEntry | null = null;
let rosterInflight: Promise<AtPocketRecordRow[]> | null = null;

function rosterCacheTtlMs(): number {
  const raw = process.env.STAFF_ROSTER_CACHE_TTL_MS?.trim();
  const n = raw ? Number(raw) : 180_000;
  if (!Number.isFinite(n) || n < 5_000) return 180_000;
  return Math.min(600_000, Math.floor(n));
}

function rosterCacheKey(): string | null {
  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const staffNameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim();
  if (!staffAppId || !staffNameFieldId) return null;
  const lineIds = staffLineUserIdFieldIdsFromEnv();
  const lineOn = staffLineBindingEnabled(lineIds);
  return `${staffAppId}\0${staffNameFieldId}\0${lineOn ? "line" : "name"}`;
}

/** スタッフ名簿一覧（短時間キャッシュ・同時リクエストは1回に集約） */
export async function fetchStaffRosterRowsCached(): Promise<
  AtPocketRecordRow[]
> {
  const key = rosterCacheKey();
  const staffAppId = process.env.STAFF_APP_ID?.trim();
  if (!key || !staffAppId) return [];

  const now = Date.now();
  if (rosterCache && rosterCache.expiresAt > now) {
    return rosterCache.rows;
  }

  if (rosterInflight) return rosterInflight;

  const lineIds = staffLineUserIdFieldIdsFromEnv();
  const lineOn = staffLineBindingEnabled(lineIds);
  const staffNameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim() ?? "";
  const auth = { apiKey: apiKeyForStaffPocketRead() };

  rosterInflight = (async () => {
    try {
      const rows = lineOn
        ? await fetchAllRecordsPages(staffAppId, "", auth)
        : (
            await fetchRecordsList(staffAppId, {
              limit: "1000",
              page: "1",
              fields: staffNameFieldId,
            })
          ).records ?? [];

      rosterCache = {
        expiresAt: Date.now() + rosterCacheTtlMs(),
        rows,
      };
      return rows;
    } finally {
      rosterInflight = null;
    }
  })();

  return rosterInflight;
}

/** 名簿キャッシュを破棄（スタッフ紐付け POST 後など） */
export function invalidateStaffRosterCache(): void {
  rosterCache = null;
  rosterInflight = null;
}

export function boundStaffFromRosterRows(
  rows: AtPocketRecordRow[],
  lineUserId: string,
): { id: string; name: string } | null {
  const staffNameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim();
  if (!staffNameFieldId) return null;

  const lineIds = staffLineUserIdFieldIdsFromEnv();
  if (!staffLineBindingEnabled(lineIds)) return null;

  for (const row of rows) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const id =
      row.recordId != null ? String(row.recordId) : row.uniqueId ?? "";
    const rawName = (rec as Record<string, unknown>)[staffNameFieldId];
    const name =
      rawName === undefined || rawName === null ? "" : String(rawName).trim();
    if (!id || !name) continue;
    if (
      staffRecordMatchesLineUser(
        rec as Record<string, unknown>,
        lineIds.lineField1,
        lineIds.lineField2,
        lineUserId,
      )
    ) {
      return { id, name };
    }
  }
  return null;
}
