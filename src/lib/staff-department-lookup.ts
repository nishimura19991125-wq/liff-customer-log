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
import {
  fetchStaffRosterRowsCached,
  registerStaffRosterDerivedCache,
} from "@/lib/staff-roster-cache";
import { pocketTableCellToPlainString } from "@/lib/staff-construction-availability";

export type StaffDepartmentLookupConfig = {
  staffAppId: string;
  nameFieldId: string;
  departmentFieldId: string;
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

/** スタッフ名簿の「部署」列（未設定時は勤務場所列へフォールバック） */
export async function resolveStaffDepartmentLookupConfig(): Promise<StaffDepartmentLookupConfig | null> {
  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const nameFieldIdEnv = process.env.STAFF_NAME_FIELD_ID?.trim();
  if (!staffAppId || !nameFieldIdEnv) return null;

  const auth = staffPocketAuth();
  const fieldsCtx: AtPocketRequestContext = {
    operation: "attendance:部署(列定義)",
    appEnv: "STAFF_APP_ID",
  };
  const appFields = await fetchAppFields(staffAppId, auth, fieldsCtx);

  const nameFieldId = resolveSchemaFieldId(
    nameFieldIdEnv,
    appFields,
    ["氏名", "担当者名", "スタッフ名", "名前", "社員名"],
  );

  const departmentFieldId =
    resolveSchemaFieldId(
      process.env.STAFF_DEPARTMENT_FIELD_ID,
      appFields,
      ["部署", "事業部", "所属", "所属部署", "部門"],
    ) ??
    resolveSchemaFieldId(
      process.env.STAFF_WORKPLACE_FIELD_ID,
      appFields,
      ["勤務場所"],
    );

  if (!nameFieldId || !departmentFieldId) return null;

  return { staffAppId, nameFieldId, departmentFieldId };
}

let cachedMap: Map<string, string> | null = null;
let cachedMapKey = "";

async function staffNameToDepartmentMap(
  cfg: StaffDepartmentLookupConfig,
): Promise<Map<string, string>> {
  const cacheKey = `${cfg.staffAppId}\u0000${cfg.nameFieldId}\u0000${cfg.departmentFieldId}`;
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
    const department = pocketTableCellToPlainString(
      pickRecordValueByFieldAliases(ro, cfg.departmentFieldId),
    );
    if (!name || !department) continue;
    if (!map.has(name)) map.set(name, department);
  }

  cachedMap = map;
  cachedMapKey = cacheKey;
  return map;
}

export async function lookupStaffDepartmentByStaffName(
  staffName: string | undefined,
): Promise<string | null> {
  const cfg = await resolveStaffDepartmentLookupConfig();
  if (!cfg) return null;
  const target = normApClStaffName(staffName);
  if (!target) return null;
  const map = await staffNameToDepartmentMap(cfg);
  return map.get(target) ?? null;
}

export async function enrichStaffNamesWithDepartments<
  T extends { staffName: string },
>(items: T[]): Promise<Array<T & { department?: string }>> {
  const cfg = await resolveStaffDepartmentLookupConfig();
  if (!cfg) return items.map((item) => ({ ...item }));
  const map = await staffNameToDepartmentMap(cfg);
  return items.map((item) => ({
    ...item,
    department: map.get(normApClStaffName(item.staffName)),
  }));
}

/**
 * 部署名を**名簿の登録順**で返す（タスクY: 定時リストの並び順）。
 *
 * 順番を環境変数で持つと、部署が増減するたびに設定変更が要る。
 * 名簿の行順から決めれば運用の手が要らない。
 * `staffNameToDepartmentMap` の Map は名簿の行順に詰めてあるので、
 * その値を順に拾って重複を落とすだけでよい。**@pocket への追加取得は無い。**
 */
export async function listStaffDepartmentsInRosterOrder(): Promise<string[]> {
  const cfg = await resolveStaffDepartmentLookupConfig();
  if (!cfg) return [];
  const map = await staffNameToDepartmentMap(cfg);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const raw of map.values()) {
    const dept = raw.trim();
    if (!dept || seen.has(dept)) continue;
    seen.add(dept);
    ordered.push(dept);
  }
  return ordered;
}

export function invalidateStaffDepartmentLookupCache(): void {
  cachedMap = null;
  cachedMapKey = "";
}

// 名簿を捨てたら部署マップも捨てる（呼び忘れを起こさないよう登録制）
registerStaffRosterDerivedCache(invalidateStaffDepartmentLookupCache);
