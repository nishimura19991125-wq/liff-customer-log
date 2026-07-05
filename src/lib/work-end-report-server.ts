import "server-only";

import {
  apiKeyForStaffPocketRead1,
  apiKeyForStaffWrite,
  fetchAppFields,
  updateRecord,
} from "@/lib/atpocket";
import {
  pickRecordValueByFieldAliases,
  resolveConfiguredFieldToSchemaUniqueId,
} from "@/lib/calendar-kojo";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";
import {
  invalidateApClStaffPickerCache,
  resolveStaffApClConfig,
} from "@/lib/staff-ap-cl-candidates";
import {
  pocketTableCellToPlainString,
  staffConstructionAvailabilityIsActive,
} from "@/lib/staff-construction-availability";
import { staffGeneralAvailabilityActiveLabel } from "@/lib/staff-general-availability";
import { resolveStaffGeneralAvailabilityConfig } from "@/lib/staff-general-availability";
import {
  boundStaffFromRosterRows,
  fetchStaffRosterRowsCached,
  invalidateStaffRosterCache,
} from "@/lib/staff-roster-cache";
import type {
  WorkEndAvailabilityField,
  WorkEndReportStatus,
} from "@/lib/work-end-report-types";

export type { WorkEndReportStatus } from "@/lib/work-end-report-types";

function workEndInactiveLabel(): string {
  return process.env.WORK_END_INACTIVE_LABEL?.trim() || "非稼働";
}

function constructionActiveLabel(): string {
  return (
    process.env.STAFF_CONSTRUCTION_AVAILABILITY_ACTIVE_LABEL?.trim() ||
    staffGeneralAvailabilityActiveLabel()
  );
}

function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

function pickFieldUniqueIdByExactCaption(
  fields: Awaited<ReturnType<typeof fetchAppFields>>,
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

function pickFieldUniqueIdByCaptions(
  fields: Awaited<ReturnType<typeof fetchAppFields>>,
  captions: string[],
): string | null {
  for (const caption of captions) {
    const id = pickFieldUniqueIdByExactCaption(fields, caption);
    if (id) return id;
  }
  return null;
}

function resolveSchemaFieldId(
  configuredId: string | undefined,
  fields: Awaited<ReturnType<typeof fetchAppFields>>,
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

async function resolveConstructionAvailabilityFieldId(): Promise<string | null> {
  const fromEnv = process.env.STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID?.trim();
  if (fromEnv) return fromEnv;

  const staffAppId = process.env.STAFF_APP_ID?.trim();
  if (!staffAppId) return null;

  const appFields = await fetchAppFields(
    staffAppId,
    { apiKey: apiKeyForStaffPocketRead1() },
    { operation: "work-end:工事対応稼働(列定義)", appEnv: "STAFF_APP_ID" },
  );

  return resolveSchemaFieldId(undefined, appFields, [
    "工事対応稼働状況",
    "工事対応 稼働状況",
    "工事稼働状況",
  ]);
}

function readAvailabilityValue(
  rec: Record<string, unknown>,
  fieldId: string,
): string {
  return pocketTableCellToPlainString(
    pickRecordValueByFieldAliases(rec, fieldId),
  );
}

async function loadStaffRowForLineUser(lineUserId: string): Promise<
  | {
      ok: true;
      staffName: string;
      staffRecordId: string;
      record: Record<string, unknown>;
    }
  | { ok: false; status: number; error: string; needsStaffBind?: boolean }
> {
  const staffAppId = process.env.STAFF_APP_ID?.trim();
  if (!staffAppId) {
    return {
      ok: false,
      status: 503,
      error: "STAFF_APP_ID が未設定です",
    };
  }

  const rows = await fetchStaffRosterRowsCached();
  const bound = boundStaffFromRosterRows(rows, lineUserId);
  if (!bound) {
    return {
      ok: false,
      status: 403,
      error: "担当者の紐付けが必要です",
      needsStaffBind: true,
    };
  }

  for (const row of rows) {
    const id =
      row.recordId != null ? String(row.recordId) : String(row.uniqueId ?? "");
    if (id !== bound.id) continue;
    const rec = row.record;
    if (!rec || typeof rec !== "object") break;
    return {
      ok: true,
      staffName: bound.name,
      staffRecordId: id,
      record: rec as Record<string, unknown>,
    };
  }

  return {
    ok: false,
    status: 404,
    error: "スタッフ名簿のレコードが見つかりませんでした",
  };
}

async function buildAvailabilityFields(
  record: Record<string, unknown>,
): Promise<
  | { ok: true; fields: WorkEndAvailabilityField[]; activeLabel: string }
  | { ok: false; error: string }
> {
  const activeLabel = staffGeneralAvailabilityActiveLabel();
  const fields: WorkEndAvailabilityField[] = [];

  const generalCfg = await resolveStaffGeneralAvailabilityConfig();
  if (generalCfg.ok) {
    const currentValue = readAvailabilityValue(record, generalCfg.cfg.fieldId);
    fields.push({
      key: "general",
      label: "稼働状況",
      fieldId: generalCfg.cfg.fieldId,
      currentValue,
      isActive: staffConstructionAvailabilityIsActive(currentValue, activeLabel),
    });
  }

  const apClCfg = await resolveStaffApClConfig();
  if (apClCfg.ok) {
    const apValue = readAvailabilityValue(
      record,
      apClCfg.cfg.apAvailabilityFieldId,
    );
    fields.push({
      key: "ap",
      label: "AP稼働状況",
      fieldId: apClCfg.cfg.apAvailabilityFieldId,
      currentValue: apValue,
      isActive: staffConstructionAvailabilityIsActive(
        apValue,
        apClCfg.cfg.activeLabel,
      ),
    });

    const clValue = readAvailabilityValue(
      record,
      apClCfg.cfg.clAvailabilityFieldId,
    );
    fields.push({
      key: "cl",
      label: "CL稼働状況",
      fieldId: apClCfg.cfg.clAvailabilityFieldId,
      currentValue: clValue,
      isActive: staffConstructionAvailabilityIsActive(
        clValue,
        apClCfg.cfg.activeLabel,
      ),
    });
  }

  const constructionFieldId = await resolveConstructionAvailabilityFieldId();
  if (constructionFieldId) {
    const constructionValue = readAvailabilityValue(record, constructionFieldId);
    const constructionActive = constructionActiveLabel();
    fields.push({
      key: "construction",
      label: "工事対応稼働状況",
      fieldId: constructionFieldId,
      currentValue: constructionValue,
      isActive: staffConstructionAvailabilityIsActive(
        constructionValue,
        constructionActive,
      ),
    });
  }

  if (fields.length === 0) {
    return {
      ok: false,
      error:
        "スタッフ名簿に稼働状況列が見つかりません。STAFF_AVAILABILITY_FIELD_ID 等の環境変数を確認してください。",
    };
  }

  return { ok: true, fields, activeLabel };
}

export async function getWorkEndReportStatusForLineUser(
  lineUserId: string,
): Promise<WorkEndReportStatus> {
  const inactiveLabel = workEndInactiveLabel();

  const staffName = await resolveBoundStaffNameForLineUser(lineUserId);
  if (!staffName) {
    return {
      configured: true,
      needsStaffBind: true,
      activeLabel: staffGeneralAvailabilityActiveLabel(),
      inactiveLabel,
      fields: [],
      canReport: false,
    };
  }

  const loaded = await loadStaffRowForLineUser(lineUserId);
  if (!loaded.ok) {
    return {
      configured: loaded.status !== 503,
      configError: loaded.error,
      needsStaffBind: loaded.needsStaffBind,
      activeLabel: staffGeneralAvailabilityActiveLabel(),
      inactiveLabel,
      fields: [],
      canReport: false,
    };
  }

  const built = await buildAvailabilityFields(loaded.record);
  if (!built.ok) {
    return {
      configured: false,
      configError: built.error,
      staffName: loaded.staffName,
      activeLabel: staffGeneralAvailabilityActiveLabel(),
      inactiveLabel,
      fields: [],
      canReport: false,
    };
  }

  const canReport = built.fields.some((f) => f.isActive);

  return {
    configured: true,
    staffName: loaded.staffName,
    activeLabel: built.activeLabel,
    inactiveLabel,
    fields: built.fields,
    canReport,
  };
}

export async function submitWorkEndReportForLineUser(
  lineUserId: string,
): Promise<
  | { ok: true; status: WorkEndReportStatus }
  | { ok: false; status: number; error: string; needsStaffBind?: boolean }
> {
  const inactiveLabel = workEndInactiveLabel();
  const loaded = await loadStaffRowForLineUser(lineUserId);
  if (!loaded.ok) {
    return {
      ok: false,
      status: loaded.status,
      error: loaded.error,
      needsStaffBind: loaded.needsStaffBind,
    };
  }

  const built = await buildAvailabilityFields(loaded.record);
  if (!built.ok) {
    return { ok: false, status: 503, error: built.error };
  }

  const activeFields = built.fields.filter((f) => f.isActive);
  if (activeFields.length === 0) {
    return {
      ok: false,
      status: 409,
      error: `すでに稼働終了済みです（${inactiveLabel}）`,
    };
  }

  const staffAppId = process.env.STAFF_APP_ID?.trim();
  if (!staffAppId) {
    return { ok: false, status: 503, error: "STAFF_APP_ID が未設定です" };
  }

  const patch: Record<string, string> = {};
  for (const field of activeFields) {
    patch[field.fieldId] = inactiveLabel;
  }

  await updateRecord(staffAppId, loaded.staffRecordId, patch, {
    apiKey: apiKeyForStaffWrite(),
  });

  invalidateStaffRosterCache(true);
  invalidateApClStaffPickerCache();

  const updatedLabels = activeFields.map((f) => f.label);
  const status = await getWorkEndReportStatusForLineUser(lineUserId);

  return {
    ok: true,
    status: {
      ...status,
      reported: true,
      updatedFields: updatedLabels,
    },
  };
}
