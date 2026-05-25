import "server-only";

import type { AtPocketFieldRow } from "@/lib/atpocket";
import { apiKeyForStaffPocketRead, fetchAppFields } from "@/lib/atpocket";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";
import {
  boundStaffFromRosterRows,
  fetchStaffRosterRowsCached,
} from "@/lib/staff-roster-cache";
import { readCustomerInfoFieldValue } from "@/lib/customer-info-record";

export type StaffDashboardViewMode = "manager" | "staff";

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

/** スタッフ名簿の権限・役職列 */
export function resolveStaffDashboardRoleFieldId(
  appFields: AtPocketFieldRow[],
): string | null {
  const env = process.env.STAFF_DASHBOARD_ROLE_FIELD_ID?.trim();
  if (env) {
    return resolveConfiguredFieldToSchemaUniqueId(env, appFields);
  }
  for (const cap of [
    "ダッシュボード権限",
    "権限",
    "役職",
    "権限区分",
    "営業権限",
  ]) {
    const id = pickFieldUniqueIdByExactCaption(appFields, cap);
    if (id) return id;
  }
  return null;
}

function managerRoleLabels(): string[] {
  const raw = process.env.STAFF_DASHBOARD_MANAGER_ROLE_VALUES?.trim();
  const defaults = [
    "管理職",
    "経営層",
    "管理者",
    "マネージャー",
    "manager",
    "admin",
    "全社",
  ];
  if (!raw) return defaults;
  return raw
    .split(",")
    .map((s) => nfkc(s))
    .filter(Boolean);
}

export function staffDashboardViewModeFromRoleValue(
  raw: string,
): StaffDashboardViewMode {
  const v = nfkc(raw);
  if (!v || v === "-" || v === "一般" || v === "営業" || v === "staff") {
    return "staff";
  }
  const lower = v.toLowerCase();
  for (const label of managerRoleLabels()) {
    const t = label.toLowerCase();
    if (v === label || lower === t || v.includes(label) || lower.includes(t)) {
      return "manager";
    }
  }
  return "staff";
}

export type BoundStaffDashboardContext = {
  staffId: string;
  staffName: string;
  viewMode: StaffDashboardViewMode;
  roleLabel: string;
};

export async function resolveBoundStaffDashboardContext(
  lineUserId: string,
): Promise<BoundStaffDashboardContext | null> {
  const staffAppId = process.env.STAFF_APP_ID?.trim();
  if (!staffAppId) return null;

  const rows = await fetchStaffRosterRowsCached();
  const bound = boundStaffFromRosterRows(rows, lineUserId);
  if (!bound) return null;

  const staffFields = await fetchAppFields(staffAppId, {
    apiKey: apiKeyForStaffPocketRead(),
  });
  const roleFieldId = resolveStaffDashboardRoleFieldId(staffFields);

  let roleRaw = "";
  for (const row of rows) {
    const id =
      row.recordId != null ? String(row.recordId) : row.uniqueId ?? "";
    if (id !== bound.id) continue;
    const rec = row.record;
    if (rec && typeof rec === "object" && roleFieldId) {
      roleRaw = readCustomerInfoFieldValue(
        rec as Record<string, unknown>,
        roleFieldId,
      );
    }
    break;
  }

  const viewMode = staffDashboardViewModeFromRoleValue(roleRaw);
  return {
    staffId: bound.id,
    staffName: bound.name,
    viewMode,
    roleLabel: roleRaw || (viewMode === "manager" ? "管理職" : "一般"),
  };
}
