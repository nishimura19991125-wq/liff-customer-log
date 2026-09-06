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

/**
 * 担当者名から**勤務場所（所属支店）と所属会社をまとめて引く**。
 *
 * ■ なぜ上の勤務場所用と別に置くか
 * 上の `resolveStaffWorkplaceLookupConfig` / `lookupStaffWorkplaceByStaffName`
 * は出勤打刻の Google Chat 通知（支社の行）も使っている。あちらの挙動を
 * 変えたくないので、既存の関数には手を入れず、お客様情報の自動入力が使う
 * 入口をこちらに足してある。列定義（fetchAppFields）も名簿の行
 * （fetchStaffRosterRowsCached）も同じキャッシュを共有するので、
 * **@pocket への問い合わせは増えない。**
 *
 * ■ 支店と会社で走査を分けない
 * 名簿の行を2周すると、片方だけ直したときに気づけない。1周で両方を
 * 詰めた Map を作り、呼び出し側は1回の照会で両方を受け取る。
 *
 * ■ 列がどちらか片方しか無くてもよい
 * 勤務場所だけ・所属会社だけ設定されている環境でも、引ける側は引く。
 * 両方とも解決できないときだけ null を返す。
 */
export type StaffAssignmentLookupConfig = {
  staffAppId: string;
  nameFieldId: string;
  /** 勤務場所（AP/CL所属支店の元） */
  workplaceFieldId: string | null;
  /** 所属会社（AP/CL所属会社の元） */
  companyFieldId: string | null;
};

/** 名簿から引けた担当者の所属。引けなかった側は null */
export type StaffAssignment = {
  workplace: string | null;
  company: string | null;
};

const STAFF_COMPANY_CAPTIONS = ["所属会社"];

export async function resolveStaffAssignmentLookupConfig(): Promise<StaffAssignmentLookupConfig | null> {
  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const nameFieldIdEnv = process.env.STAFF_NAME_FIELD_ID?.trim();
  if (!staffAppId || !nameFieldIdEnv) return null;

  const auth = staffPocketAuth();
  const fieldsCtx: AtPocketRequestContext = {
    operation: "customer-info:AP/CL所属支店・所属会社(列定義)",
    appEnv: "STAFF_APP_ID",
  };
  const appFields = await fetchAppFields(staffAppId, auth, fieldsCtx);

  const nameFieldId = resolveSchemaFieldId(nameFieldIdEnv, appFields, [
    "氏名",
    "担当者名",
    "スタッフ名",
    "名前",
  ]);
  const workplaceFieldId = resolveSchemaFieldId(
    process.env.STAFF_WORKPLACE_FIELD_ID,
    appFields,
    ["勤務場所"],
  );
  const companyFieldId = resolveSchemaFieldId(
    process.env.STAFF_COMPANY_FIELD_ID,
    appFields,
    STAFF_COMPANY_CAPTIONS,
  );

  if (!nameFieldId) return null;
  // どちらも解決できないなら引く先が無い
  if (!workplaceFieldId && !companyFieldId) return null;

  return { staffAppId, nameFieldId, workplaceFieldId, companyFieldId };
}

let cachedAssignmentMap: Map<string, StaffAssignment> | null = null;
let cachedAssignmentMapKey = "";

async function staffNameToAssignmentMap(
  cfg: StaffAssignmentLookupConfig,
): Promise<Map<string, StaffAssignment>> {
  const cacheKey = `${cfg.staffAppId}\u0000${cfg.nameFieldId}\u0000${cfg.workplaceFieldId ?? ""}\u0000${cfg.companyFieldId ?? ""}`;
  if (cachedAssignmentMap && cachedAssignmentMapKey === cacheKey) {
    return cachedAssignmentMap;
  }

  const rows = await fetchStaffRosterRowsCached();
  const map = new Map<string, StaffAssignment>();
  for (const row of rows) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const ro = rec as Record<string, unknown>;
    const name = normApClStaffName(
      pocketTableCellToPlainString(
        pickRecordValueByFieldAliases(ro, cfg.nameFieldId),
      ),
    );
    if (!name || map.has(name)) continue;

    const workplace = cfg.workplaceFieldId
      ? pocketTableCellToPlainString(
          pickRecordValueByFieldAliases(ro, cfg.workplaceFieldId),
        )
      : "";
    const company = cfg.companyFieldId
      ? pocketTableCellToPlainString(
          pickRecordValueByFieldAliases(ro, cfg.companyFieldId),
        )
      : "";
    // どちらも空の行は入れない（勤務場所側の従来の作りに合わせる）
    if (!workplace && !company) continue;

    map.set(name, {
      workplace: workplace || null,
      company: company || null,
    });
  }

  cachedAssignmentMap = map;
  cachedAssignmentMapKey = cacheKey;
  return map;
}

/** AP/CL担当者名に一致するスタッフ名簿レコードの勤務場所・所属会社 */
export async function lookupStaffAssignmentByStaffName(
  staffName: string | undefined,
  cfg: StaffAssignmentLookupConfig,
): Promise<StaffAssignment> {
  const target = normApClStaffName(staffName);
  if (!target) return { workplace: null, company: null };
  const map = await staffNameToAssignmentMap(cfg);
  return map.get(target) ?? { workplace: null, company: null };
}

/** 名簿キャッシュ更新後に所属マップを破棄 */
export function invalidateStaffAssignmentLookupCache(): void {
  cachedAssignmentMap = null;
  cachedAssignmentMapKey = "";
}
