import "server-only";

import type { AtPocketFieldRow, AtPocketRequestContext } from "@/lib/atpocket";
import {
  apiKeyForStaffPocketRead,
  fetchAllRecordsPages,
  fetchAppFields,
} from "@/lib/atpocket";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import {
  pocketTableCellToPlainString,
  staffConstructionAvailabilityIsActive,
} from "@/lib/staff-construction-availability";
import { staffRecordMatchesLineUser } from "@/lib/staff-line-binding";

export type ApClStaffRolePicker = {
  options: string[];
  /** LINE 紐付け名が当該稼働リストに含まれるときのみ */
  defaultName: string | null;
};

export type ApClStaffPickerPayload = {
  configured: boolean;
  ap: ApClStaffRolePicker;
  cl: ApClStaffRolePicker;
};

type StaffApClConfig = {
  staffAppId: string;
  nameFieldId: string;
  apAvailabilityFieldId: string;
  clAvailabilityFieldId: string;
  activeLabel: string;
  lineField1?: string;
  lineField2?: string;
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

function uniqueFieldsCsv(...uids: (string | undefined)[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const u of uids) {
    const t = u?.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      parts.push(t);
    }
  }
  return parts.join(",");
}

function activeAvailabilityLabel(): string {
  return (
    process.env.STAFF_AP_CL_AVAILABILITY_ACTIVE_LABEL?.trim() ||
    process.env.STAFF_CONSTRUCTION_AVAILABILITY_ACTIVE_LABEL?.trim() ||
    "稼働"
  );
}

async function resolveStaffApClConfig(): Promise<StaffApClConfig | null> {
  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const nameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim();
  if (!staffAppId || !nameFieldId) return null;

  const auth = { apiKey: apiKeyForStaffPocketRead() };
  const fieldsCtx: AtPocketRequestContext = {
    operation: "customer-info:AP/CL担当者(列定義)",
    appEnv: "STAFF_APP_ID",
  };
  const appFields = await fetchAppFields(staffAppId, auth, fieldsCtx);

  let apAvailabilityFieldId =
    process.env.STAFF_AP_AVAILABILITY_FIELD_ID?.trim();
  if (!apAvailabilityFieldId) {
    apAvailabilityFieldId =
      pickFieldUniqueIdByExactCaption(appFields, "AP稼働状況") ?? undefined;
  }

  let clAvailabilityFieldId =
    process.env.STAFF_CL_AVAILABILITY_FIELD_ID?.trim();
  if (!clAvailabilityFieldId) {
    clAvailabilityFieldId =
      pickFieldUniqueIdByExactCaption(appFields, "CL稼働状況") ?? undefined;
  }

  if (!apAvailabilityFieldId || !clAvailabilityFieldId) return null;

  const lineField1 = process.env.STAFF_LINE_USER_ID_FIELD_ID?.trim();
  const lineField2 = process.env.STAFF_LINE_USER_ID_FIELD_ID_2?.trim();

  return {
    staffAppId,
    nameFieldId,
    apAvailabilityFieldId,
    clAvailabilityFieldId,
    activeLabel: activeAvailabilityLabel(),
    lineField1: lineField1 || undefined,
    lineField2: lineField2 || undefined,
  };
}

const emptyPicker = (): ApClStaffPickerPayload => ({
  configured: false,
  ap: { options: [], defaultName: null },
  cl: { options: [], defaultName: null },
});

/**
 * AP/CL担当者プルダウン用。
 * AP稼働状況・CL稼働状況が activeLabel（既定「稼働」）の社員名のみ。
 * LINE_USER_ID / LINE_USER_ID② に一致する社員名を defaultName にする（リストに含まれる場合のみ）。
 */
export async function fetchApClStaffPickerPayload(
  lineUserId: string,
): Promise<ApClStaffPickerPayload> {
  const cfg = await resolveStaffApClConfig();
  if (!cfg) return emptyPicker();

  const auth = { apiKey: apiKeyForStaffPocketRead() };
  const listCtx: AtPocketRequestContext = {
    operation: "customer-info:AP/CL担当者(名簿一覧)",
    appEnv: "STAFF_APP_ID",
  };
  const csv = uniqueFieldsCsv(
    cfg.nameFieldId,
    cfg.apAvailabilityFieldId,
    cfg.clAvailabilityFieldId,
    cfg.lineField1,
    cfg.lineField2,
  );
  const rows = await fetchAllRecordsPages(
    cfg.staffAppId,
    csv,
    auth,
    null,
    listCtx,
  );

  const apNames = new Set<string>();
  const clNames = new Set<string>();
  let boundStaffName: string | null = null;
  const wantLine = nfkc(lineUserId);

  for (const row of rows) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const ro = rec as Record<string, unknown>;
    const name = normApClStaffName(
      pocketTableCellToPlainString(ro[cfg.nameFieldId]),
    );
    if (!name) continue;

    if (
      staffConstructionAvailabilityIsActive(
        ro[cfg.apAvailabilityFieldId],
        cfg.activeLabel,
      )
    ) {
      apNames.add(name);
    }
    if (
      staffConstructionAvailabilityIsActive(
        ro[cfg.clAvailabilityFieldId],
        cfg.activeLabel,
      )
    ) {
      clNames.add(name);
    }

    if (
      !boundStaffName &&
      wantLine &&
      cfg.lineField1 &&
      staffRecordMatchesLineUser(
        ro,
        cfg.lineField1,
        cfg.lineField2,
        wantLine,
      )
    ) {
      boundStaffName = name;
    }
  }

  const apOptions = [...apNames].sort((a, b) => a.localeCompare(b, "ja"));
  const clOptions = [...clNames].sort((a, b) => a.localeCompare(b, "ja"));

  const apDefault =
    boundStaffName && apNames.has(boundStaffName) ? boundStaffName : null;
  const clDefault =
    boundStaffName && clNames.has(boundStaffName) ? boundStaffName : null;

  return {
    configured: true,
    ap: { options: apOptions, defaultName: apDefault },
    cl: { options: clOptions, defaultName: clDefault },
  };
}
