import "server-only";

import type { AtPocketFetchAuth, AtPocketFieldRow } from "@/lib/atpocket";
import { fetchAllRecordsPages, fetchAppFields } from "@/lib/atpocket";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { pocketTableCellToPlainString } from "@/lib/staff-construction-availability";

export type StaffWorkplaceLookupConfig = {
  staffAppId: string;
  nameFieldId: string;
  workplaceFieldId: string;
  pocketAuth?: AtPocketFetchAuth;
};

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

function pickFieldUniqueIdByExactCaption(
  fields: AtPocketFieldRow[],
  caption: string,
): string | null {
  const target = nfkc(caption).toLowerCase();
  for (const f of fields) {
    const cap = f.caption ? nfkc(String(f.caption)).toLowerCase() : "";
    if (cap && cap === target) {
      const id = f.uniqueId?.trim();
      return id || null;
    }
  }
  return null;
}

export async function resolveStaffWorkplaceLookupConfig(
  pocketAuth?: AtPocketFetchAuth,
): Promise<StaffWorkplaceLookupConfig | null> {
  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const nameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim();
  if (!staffAppId || !nameFieldId) return null;

  let workplaceFieldId = process.env.STAFF_WORKPLACE_FIELD_ID?.trim();
  if (!workplaceFieldId) {
    const appFields = await fetchAppFields(staffAppId, pocketAuth);
    workplaceFieldId =
      pickFieldUniqueIdByExactCaption(appFields, "勤務場所") ?? undefined;
  }
  if (!workplaceFieldId) return null;

  return {
    staffAppId,
    nameFieldId,
    workplaceFieldId,
    pocketAuth,
  };
}

let cachedMap: Map<string, string> | null = null;
let cachedMapKey = "";

async function staffNameToWorkplaceMap(
  cfg: StaffWorkplaceLookupConfig,
): Promise<Map<string, string>> {
  const cacheKey = `${cfg.staffAppId}\0${cfg.nameFieldId}\0${cfg.workplaceFieldId}`;
  if (cachedMap && cachedMapKey === cacheKey) return cachedMap;

  const csv = [cfg.nameFieldId, cfg.workplaceFieldId].join(",");
  const rows = await fetchAllRecordsPages(
    cfg.staffAppId,
    csv,
    cfg.pocketAuth,
  );
  const map = new Map<string, string>();
  for (const row of rows) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const ro = rec as Record<string, unknown>;
    const name = normApClStaffName(
      pocketTableCellToPlainString(ro[cfg.nameFieldId]),
    );
    const workplace = pocketTableCellToPlainString(
      ro[cfg.workplaceFieldId],
    );
    if (!name || !workplace) continue;
    if (!map.has(name)) map.set(name, workplace);
  }

  cachedMap = map;
  cachedMapKey = cacheKey;
  return map;
}

/** 担当者名（AP/CL）に一致するスタッフ名簿レコードの勤務場所 */
export async function lookupStaffWorkplaceByStaffName(
  staffName: string | undefined,
  cfg: StaffWorkplaceLookupConfig,
): Promise<string | null> {
  const target = normApClStaffName(staffName);
  if (!target) return null;
  const map = await staffNameToWorkplaceMap(cfg);
  return map.get(target) ?? null;
}
