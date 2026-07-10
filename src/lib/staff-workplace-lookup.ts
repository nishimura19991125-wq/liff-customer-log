import "server-only";

import type { AtPocketFieldRow, AtPocketRequestContext } from "@/lib/atpocket";
import {
  apiKeyForStaffPocketReadApClList,
  fetchAppFields,
} from "@/lib/atpocket";
import {
  pickRecordValueByFieldAliases,
  resolveConfiguredFieldToSchemaUniqueId,
} from "@/lib/calendar-kojo";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { fetchStaffRosterRowsCached } from "@/lib/staff-roster-cache";
import { pocketTableCellToPlainString } from "@/lib/staff-construction-availability";

export type StaffWorkplaceLookupConfig = {
  staffAppId: string;
  nameFieldId: string;
  workplaceFieldId: string;
};

function staffPocketAuth() {
  return { apiKey: apiKeyForStaffPocketReadApClList() };
}

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

function pickFieldUniqueIdByCaptions(
  fields: AtPocketFieldRow[],
  captions: string[],
): string | null {
  const targetSet = new Set(captions.map((c) => nfkc(c).toLowerCase()));
  for (const f of fields) {
    const cap = f.caption ? nfkc(String(f.caption)).toLowerCase() : "";
    if (cap && targetSet.has(cap)) {
      const id = f.uniqueId?.trim();
      return id || null;
    }
  }
  return null;
}

function resolveSchemaFieldId(
  configuredId: string | undefined,
  fields: AtPocketFieldRow[],
  captionAlts: string[],
): string | null {
  const fromEnv = configuredId?.trim();
  if (fromEnv) {
    return resolveConfiguredFieldToSchemaUniqueId(fromEnv, fields);
  }
  const picked = pickFieldUniqueIdByCaptions(fields, captionAlts);
  if (!picked) return null;
  return resolveConfiguredFieldToSchemaUniqueId(picked, fields) ?? picked;
}

export async function resolveStaffWorkplaceLookupConfig(): Promise<StaffWorkplaceLookupConfig | null> {
  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const nameFieldIdEnv = process.env.STAFF_NAME_FIELD_ID?.trim();
  if (!staffAppId || !nameFieldIdEnv) return null;

  const auth = staffPocketAuth();
  const fieldsCtx: AtPocketRequestContext = {
    operation: "customer-info:AP/CL所属支店(列定義)",
    appEnv: "STAFF_APP_ID",
  };
  const appFields = await fetchAppFields(staffAppId, auth, fieldsCtx);

  const nameFieldId = resolveSchemaFieldId(
    nameFieldIdEnv,
    appFields,
    ["氏名", "担当者名", "スタッフ名", "名前"],
  );
  const workplaceFieldId = resolveSchemaFieldId(
    process.env.STAFF_WORKPLACE_FIELD_ID,
    appFields,
    ["勤務場所"],
  );

  if (!nameFieldId || !workplaceFieldId) return null;

  return {
    staffAppId,
    nameFieldId,
    workplaceFieldId,
  };
}

let cachedMap: Map<string, string> | null = null;
let cachedMapKey = "";

async function staffNameToWorkplaceMap(
  cfg: StaffWorkplaceLookupConfig,
): Promise<Map<string, string>> {
  const cacheKey = `${cfg.staffAppId}\u0000${cfg.nameFieldId}\u0000${cfg.workplaceFieldId}`;
  if (cachedMap && cachedMapKey === cacheKey) return cachedMap;

  const rows = await fetchStaffRosterRowsCached();
  const map = new Map<string, string>();
  for (const row of rows) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const ro = rec as Record<string, unknown>;
    const name = normApClStaffName(
      pocketTableCellToPlainString(
        pickRecordValueByFieldAliases(ro, cfg.nameFieldId),
      ),
    );
    const workplace = pocketTableCellToPlainString(
      pickRecordValueByFieldAliases(ro, cfg.workplaceFieldId),
    );
    if (!name || !workplace) continue;
    if (!map.has(name)) map.set(name, workplace);
  }

  cachedMap = map;
  cachedMapKey = cacheKey;
  return map;
}

/** AP/CL担当者名に一致するスタッフ名簿レコードの勤務場所 */
export async function lookupStaffWorkplaceByStaffName(
  staffName: string | undefined,
  cfg: StaffWorkplaceLookupConfig,
): Promise<string | null> {
  const target = normApClStaffName(staffName);
  if (!target) return null;
  const map = await staffNameToWorkplaceMap(cfg);
  return map.get(target) ?? null;
}

/** 名簿キャッシュ更新後に勤務場所マップを破棄 */
export function invalidateStaffWorkplaceLookupCache(): void {
  cachedMap = null;
  cachedMapKey = "";
}
