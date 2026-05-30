import "server-only";

import type {
  AtPocketFieldRow,
  AtPocketRecordRow,
  AtPocketRequestContext,
} from "@/lib/atpocket";
import {
  apiKeyForStaffPocketRead1,
  fetchAppFields,
  fetchRecordsList,
} from "@/lib/atpocket";
import { pickRecordValueByFieldAliases } from "@/lib/calendar-kojo";
import {
  fetchStaffRosterRowsCached,
  getStaffRosterRowsBestEffort,
  staffRosterCacheTtlMs,
} from "@/lib/staff-roster-cache";
import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";
import {
  pocketTableCellToPlainString,
  staffConstructionAvailabilityIsActive,
} from "@/lib/staff-construction-availability";
import { staffLineUserIdFieldIdsFromEnv } from "@/lib/staff-line-field-config";
import { staffRecordMatchesLineUser } from "@/lib/staff-line-binding";
import { resolveConfiguredFieldToSchemaUniqueId } from "@/lib/calendar-kojo";

export type ApClStaffRolePicker = {
  options: string[];
  /** LINE 紐付け名が当該稼働リストに含まれるときのみ */
  defaultName: string | null;
};

export type ApClStaffPickerPayload = {
  configured: boolean;
  /** configured=false のときの理由（環境変数・列未定義など） */
  configError?: string;
  /** 名簿が空・429 フォールバック時 */
  rosterEmpty?: boolean;
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

function pickFieldUniqueIdByCaptions(
  fields: AtPocketFieldRow[],
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

function activeAvailabilityLabel(): string {
  return (
    process.env.STAFF_AP_CL_AVAILABILITY_ACTIVE_LABEL?.trim() ||
    process.env.STAFF_CONSTRUCTION_AVAILABILITY_ACTIVE_LABEL?.trim() ||
    "稼働"
  );
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

async function resolveStaffApClConfig(): Promise<
  | { ok: true; cfg: StaffApClConfig }
  | { ok: false; error: string }
> {
  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const nameFieldIdEnv = process.env.STAFF_NAME_FIELD_ID?.trim();
  if (!staffAppId || !nameFieldIdEnv) {
    return {
      ok: false,
      error:
        "STAFF_APP_ID または STAFF_NAME_FIELD_ID が未設定です。Netlify の環境変数を確認してください。",
    };
  }

  const auth = { apiKey: apiKeyForStaffPocketRead1() };
  const fieldsCtx: AtPocketRequestContext = {
    operation: "customer-info:AP/CL担当者(列定義)",
    appEnv: "STAFF_APP_ID",
  };
  const appFields = await fetchAppFields(staffAppId, auth, fieldsCtx);

  const nameFieldId = resolveSchemaFieldId(
    nameFieldIdEnv,
    appFields,
    ["氏名", "担当者名", "スタッフ名", "名前"],
  );
  if (!nameFieldId) {
    return {
      ok: false,
      error: `氏名列「${nameFieldIdEnv}」がスタッフ名簿アプリのフィールド定義と一致しません。`,
    };
  }

  const apAvailabilityFieldId = resolveSchemaFieldId(
    process.env.STAFF_AP_AVAILABILITY_FIELD_ID,
    appFields,
    ["AP稼働状況", "AP 稼働状況", "AP担当稼働状況", "AP担当者稼働状況"],
  );
  const clAvailabilityFieldId = resolveSchemaFieldId(
    process.env.STAFF_CL_AVAILABILITY_FIELD_ID,
    appFields,
    ["CL稼働状況", "CL 稼働状況", "CL担当稼働状況", "CL担当者稼働状況"],
  );

  if (!apAvailabilityFieldId || !clAvailabilityFieldId) {
    const missing: string[] = [];
    if (!apAvailabilityFieldId) missing.push("AP稼働状況");
    if (!clAvailabilityFieldId) missing.push("CL稼働状況");
    return {
      ok: false,
      error: `スタッフ名簿に ${missing.join("・")} 列が見つかりません。見出し名を確認するか STAFF_AP_AVAILABILITY_FIELD_ID / STAFF_CL_AVAILABILITY_FIELD_ID を設定してください。`,
    };
  }

  const lineIds = staffLineUserIdFieldIdsFromEnv();

  return {
    ok: true,
    cfg: {
      staffAppId,
      nameFieldId,
      apAvailabilityFieldId,
      clAvailabilityFieldId,
      activeLabel: activeAvailabilityLabel(),
      lineField1: lineIds.lineField1,
      lineField2: lineIds.lineField2,
    },
  };
}

const emptyPicker = (configError?: string): ApClStaffPickerPayload => ({
  configured: false,
  ...(configError ? { configError } : {}),
  ap: { options: [], defaultName: null },
  cl: { options: [], defaultName: null },
});

type PickerCacheEntry = {
  expiresAt: number;
  payload: ApClStaffPickerPayload;
};

const pickerCache = new Map<string, PickerCacheEntry>();
const pickerInflight = new Map<string, Promise<ApClStaffPickerPayload>>();

function pickerCacheTtlMs(): number {
  return staffRosterCacheTtlMs();
}

function rosterRowHasApClFields(
  row: AtPocketRecordRow,
  cfg: StaffApClConfig,
): boolean {
  const rec = row.record;
  if (!rec || typeof rec !== "object") return false;
  const ro = rec as Record<string, unknown>;
  return (
    pickRecordValueByFieldAliases(ro, cfg.apAvailabilityFieldId) !==
      undefined ||
    pickRecordValueByFieldAliases(ro, cfg.clAvailabilityFieldId) !== undefined
  );
}

/** AP/CL 列を必ず含めて名簿を取得（キャッシュに列が無いときは再取得） */
async function fetchStaffRowsForApClPicker(
  cfg: StaffApClConfig,
): Promise<{ rows: AtPocketRecordRow[]; rosterEmpty: boolean }> {
  const cached = await fetchStaffRosterRowsCached();
  if (cached.length > 0 && cached.some((r) => rosterRowHasApClFields(r, cfg))) {
    return { rows: cached, rosterEmpty: false };
  }

  const stale = getStaffRosterRowsBestEffort();
  if (stale.length > 0 && stale.some((r) => rosterRowHasApClFields(r, cfg))) {
    return { rows: stale, rosterEmpty: false };
  }

  const auth = { apiKey: apiKeyForStaffPocketRead1() };
  const fieldsCsv = uniqueFieldsCsv(
    cfg.nameFieldId,
    cfg.apAvailabilityFieldId,
    cfg.clAvailabilityFieldId,
    cfg.lineField1,
    cfg.lineField2,
  );
  const data = await fetchRecordsList(
    cfg.staffAppId,
    { limit: "1000", page: "1", fields: fieldsCsv },
    auth,
    {
      operation: "customer-info:AP/CL担当者(名簿)",
      appEnv: "STAFF_APP_ID",
    },
    { maxRetries: 0 },
  );
  const rows = data.records ?? [];
  return { rows, rosterEmpty: rows.length === 0 };
}

function buildApClPickerPayload(
  cfg: StaffApClConfig,
  rows: AtPocketRecordRow[],
  lineUserId: string,
): ApClStaffPickerPayload {
  const apNames = new Set<string>();
  const clNames = new Set<string>();
  let boundStaffName: string | null = null;
  const wantLine = nfkc(lineUserId);

  for (const row of rows) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const ro = rec as Record<string, unknown>;
    const name = normApClStaffName(
      pocketTableCellToPlainString(
        pickRecordValueByFieldAliases(ro, cfg.nameFieldId),
      ),
    );
    if (!name) continue;

    if (
      staffConstructionAvailabilityIsActive(
        pickRecordValueByFieldAliases(ro, cfg.apAvailabilityFieldId),
        cfg.activeLabel,
      )
    ) {
      apNames.add(name);
    }
    if (
      staffConstructionAvailabilityIsActive(
        pickRecordValueByFieldAliases(ro, cfg.clAvailabilityFieldId),
        cfg.activeLabel,
      )
    ) {
      clNames.add(name);
    }

    if (
      !boundStaffName &&
      wantLine &&
      (cfg.lineField1 || cfg.lineField2) &&
      staffRecordMatchesLineUser(ro, cfg.lineField1, cfg.lineField2, wantLine)
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
    rosterEmpty: rows.length === 0,
    ap: { options: apOptions, defaultName: apDefault },
    cl: { options: clOptions, defaultName: clDefault },
  };
}

/**
 * AP/CL担当者プルダウン用。
 * AP稼働状況・CL稼働状況が activeLabel（既定「稼働」）の社員名のみ。
 * LINE_USER_ID①・LINE_USER_ID② のいずれかに一致する社員名を defaultName にする（リストに含まれる場合のみ）。
 */
export async function fetchApClStaffPickerPayload(
  lineUserId: string,
): Promise<ApClStaffPickerPayload> {
  const wantLine = nfkc(lineUserId);
  if (!wantLine) return emptyPicker();

  const now = Date.now();
  const cached = pickerCache.get(wantLine);
  if (cached && cached.expiresAt > now) {
    return cached.payload;
  }

  const pending = pickerInflight.get(wantLine);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const resolved = await resolveStaffApClConfig();
      if (!resolved.ok) {
        return emptyPicker(resolved.error);
      }
      const cfg = resolved.cfg;

      const { rows, rosterEmpty } = await fetchStaffRowsForApClPicker(cfg);
      const payload = buildApClPickerPayload(cfg, rows, wantLine);
      if (rosterEmpty) {
        payload.rosterEmpty = true;
      }
      if (
        payload.ap.options.length === 0 &&
        payload.cl.options.length === 0 &&
        rows.length > 0
      ) {
        payload.configError = `「${cfg.activeLabel}」の担当者が名簿にいません。AP/CL稼働状況の値と STAFF_AP_CL_AVAILABILITY_ACTIVE_LABEL（既定: 稼働）を確認してください。`;
      }
      pickerCache.set(wantLine, {
        expiresAt: Date.now() + pickerCacheTtlMs(),
        payload,
      });
      return payload;
    } finally {
      pickerInflight.delete(wantLine);
    }
  })();

  pickerInflight.set(wantLine, promise);
  return promise;
}

/** スタッフ紐付け変更後に AP/CL プルダウンキャッシュを破棄 */
export function invalidateApClStaffPickerCache(): void {
  pickerCache.clear();
  pickerInflight.clear();
}

/**
 * LINE_USER_ID①・② に一致し、AP/CL 稼働が「稼働」のときの担当者名（工事→お客様情報連携用）。
 */
export async function defaultApClStaffNamesForLineUser(
  lineUserId: string,
): Promise<{ apStaff: string | null; clStaff: string | null }> {
  const payload = await fetchApClStaffPickerPayload(lineUserId);
  return {
    apStaff: payload.ap.defaultName,
    clStaff: payload.cl.defaultName,
  };
}
