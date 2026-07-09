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
import { formatPhoneNumberInput } from "@/lib/customer-info-form/phone-number";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import { pocketTableCellToPlainString } from "@/lib/staff-construction-availability";
import { fetchStaffRosterRowsCached } from "@/lib/staff-roster-cache";

export type StaffContactEntry = {
  staffName: string;
  phone: string;
};

export type StaffContactDepartmentGroup = {
  department: string;
  contacts: StaffContactEntry[];
};

export type StaffContactsDirectoryConfig = {
  staffAppId: string;
  nameFieldId: string;
  departmentFieldId: string;
  phoneFieldId: string;
  workplaceFieldId: string | null;
};

const DC_DEPARTMENT = "DC事業部";

const DC_WORKPLACE_ORDER = [
  "奈良本社",
  "京都支社",
  "名古屋支社",
  "埼玉支社",
] as const;

export const DEFAULT_STAFF_CONTACTS_DEPARTMENT_ORDER = [
  "役員",
  "DC事業部",
  "DX事業部",
  "経理部",
  "事務管理部",
  "工務店アライアンス事業部",
  "人事部",
  "パーソナルトラーチ",
  "施工管理部",
] as const;

export const STAFF_CONTACTS_EXCLUDED_NAMES = [
  "安若滉平",
  "岡崎大",
  "加藤綾野",
  "金子流威",
  "若松寅二",
  "浅井仁美",
  "中村祐貴",
  "中田拳斗",
  "田中孝明",
  "東良悠喜",
  "湯野昌",
  "浜田拓哉",
  "野尻千紘",
  "宮嶋祐槻",
  "稗田早希",
  "大江祐規",
] as const;

function isExcludedStaffName(name: string): boolean {
  const normalized = normApClStaffName(name);
  if (!normalized) return true;
  return STAFF_CONTACTS_EXCLUDED_NAMES.some(
    (excluded) => normApClStaffName(excluded) === normalized,
  );
}

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

export async function resolveStaffContactsDirectoryConfig(): Promise<StaffContactsDirectoryConfig | null> {
  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const nameFieldIdEnv = process.env.STAFF_NAME_FIELD_ID?.trim();
  if (!staffAppId || !nameFieldIdEnv) return null;

  const auth = staffPocketAuth();
  const fieldsCtx: AtPocketRequestContext = {
    operation: "contacts:列定義",
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
  const phoneFieldId = resolveSchemaFieldId(
    process.env.STAFF_PHONE_FIELD_ID,
    appFields,
    ["連絡先", "電話番号", "電話", "TEL", "tel", "携帯", "スタッフ連絡先"],
  );
  const workplaceFieldId = resolveSchemaFieldId(
    process.env.STAFF_WORKPLACE_FIELD_ID,
    appFields,
    ["勤務場所"],
  );

  if (!nameFieldId || !departmentFieldId || !phoneFieldId) return null;

  return {
    staffAppId,
    nameFieldId,
    departmentFieldId,
    phoneFieldId,
    workplaceFieldId,
  };
}

function normalizeDepartmentLabel(label: string): string {
  return nfkc(label)
    .replace(/俱/g, "倶")
    .toLowerCase();
}

function resolveAllowedDepartment(
  raw: string,
  allowed: readonly string[],
): string | null {
  const normalized = normalizeDepartmentLabel(raw);
  if (!normalized) return null;

  for (const dept of allowed) {
    if (normalizeDepartmentLabel(dept) === normalized) return dept;
  }
  for (const dept of allowed) {
    const target = normalizeDepartmentLabel(dept);
    if (normalized.includes(target) || target.includes(normalized)) return dept;
  }
  return null;
}

function contactsDisplayGroup(
  department: string,
  workplace: string,
): string {
  if (department !== DC_DEPARTMENT) return department;
  const place = nfkc(workplace);
  return place ? `${DC_DEPARTMENT}（${place}）` : DC_DEPARTMENT;
}

function departmentSortIndex(department: string, order: readonly string[]): number {
  const normalized = normalizeDepartmentLabel(department);
  const dcLabel = normalizeDepartmentLabel(DC_DEPARTMENT);
  if (normalized === dcLabel || normalized.startsWith(`${dcLabel}（`)) {
    const dcIndex = order.findIndex(
      (item) => normalizeDepartmentLabel(item) === dcLabel,
    );
    if (dcIndex >= 0) return dcIndex;
  }
  for (let i = 0; i < order.length; i++) {
    const target = normalizeDepartmentLabel(order[i]!);
    if (normalized === target) return i;
  }
  for (let i = 0; i < order.length; i++) {
    const target = normalizeDepartmentLabel(order[i]!);
    if (normalized.includes(target) || target.includes(normalized)) return i;
  }
  return order.length;
}

function dcWorkplaceSortIndex(groupLabel: string): number {
  const match = groupLabel.match(/（(.+)）$/);
  if (!match) return DC_WORKPLACE_ORDER.length;
  const place = normalizeDepartmentLabel(match[1]!);
  for (let i = 0; i < DC_WORKPLACE_ORDER.length; i++) {
    if (normalizeDepartmentLabel(DC_WORKPLACE_ORDER[i]!) === place) return i;
  }
  return DC_WORKPLACE_ORDER.length;
}

function formatContactPhone(raw: string): string {
  const trimmed = nfkc(raw);
  if (!trimmed) return "";
  return formatPhoneNumberInput(trimmed) || trimmed;
}

export async function fetchStaffContactsByDepartment(
  departmentOrder: readonly string[],
): Promise<
  | { ok: true; groups: StaffContactDepartmentGroup[] }
  | { ok: false; error: string }
> {
  const cfg = await resolveStaffContactsDirectoryConfig();
  if (!cfg) {
    return {
      ok: false,
      error:
        "スタッフ名簿の連絡先設定が不足しています。STAFF_APP_ID・STAFF_NAME_FIELD_ID・STAFF_DEPARTMENT_FIELD_ID（または STAFF_WORKPLACE_FIELD_ID）・連絡先列（STAFF_PHONE_FIELD_ID）を確認してください。",
    };
  }

  const rows = await fetchStaffRosterRowsCached();
  const grouped = new Map<string, StaffContactEntry[]>();

  for (const row of rows) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const ro = rec as Record<string, unknown>;

    const staffName = nfkc(
      pocketTableCellToPlainString(
        pickRecordValueByFieldAliases(ro, cfg.nameFieldId),
      ),
    );
    if (!staffName || isExcludedStaffName(staffName)) continue;

    const departmentRaw = nfkc(
      pocketTableCellToPlainString(
        pickRecordValueByFieldAliases(ro, cfg.departmentFieldId),
      ),
    );
    const department = resolveAllowedDepartment(
      departmentRaw,
      departmentOrder,
    );
    if (!department) continue;

    const phone = formatContactPhone(
      pocketTableCellToPlainString(
        pickRecordValueByFieldAliases(ro, cfg.phoneFieldId),
      ),
    );

    const workplace =
      department === DC_DEPARTMENT && cfg.workplaceFieldId
        ? nfkc(
            pocketTableCellToPlainString(
              pickRecordValueByFieldAliases(ro, cfg.workplaceFieldId),
            ),
          )
        : "";

    const groupLabel = contactsDisplayGroup(department, workplace);
    const list = grouped.get(groupLabel) ?? [];
    list.push({ staffName, phone });
    grouped.set(groupLabel, list);
  }

  const groups = [...grouped.entries()]
    .map(([department, contacts]) => ({
      department,
      contacts: contacts.sort((a, b) =>
        a.staffName.localeCompare(b.staffName, "ja"),
      ),
    }))
    .sort((a, b) => {
      const ai = departmentSortIndex(a.department, departmentOrder);
      const bi = departmentSortIndex(b.department, departmentOrder);
      if (ai !== bi) return ai - bi;
      const adc = dcWorkplaceSortIndex(a.department);
      const bdc = dcWorkplaceSortIndex(b.department);
      if (adc !== bdc) return adc - bdc;
      return a.department.localeCompare(b.department, "ja");
    });

  return { ok: true, groups };
}
