import "server-only";

import type { AtPocketFieldRow, AtPocketRequestContext } from "@/lib/atpocket";
import {
  apiKeyForStaffPocketReadApClList,
  fetchAppFields,
  fetchRecordById,
} from "@/lib/atpocket";
import {
  pickRecordValueByFieldAliases,
  resolveConfiguredFieldToSchemaUniqueId,
} from "@/lib/calendar-kojo";
import { fetchStaffRosterRowsCached } from "@/lib/staff-roster-cache";
import {
  readStaffImportKeyFromRawRecord,
  staffImportKeyFieldIdResolved,
} from "@/lib/staff-import-key";
import {
  nfkcNormalize,
  pocketTableCellToPlainString,
  staffConstructionAvailabilityIsActive,
} from "@/lib/staff-construction-availability";

export type ConstructionHandlerStaffCandidate = {
  staffRecordId: string;
  /** @pocket 名簿フィールド由来・工事アプリへの PUT に使う値 */
  name: string;
  /** LIFF 表示用（同名が複数いるときは社員 ID などで区別） */
  label: string;
};

type ConstructionHandlerStaffConfig = {
  staffAppId: string;
  nameFieldId: string;
  availabilityFieldId: string;
  activeLabel: string;
};

export function constructionHandlerStaffConfigReady(): boolean {
  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const nameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim();
  const availabilityFieldId =
    process.env.STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID?.trim();
  return Boolean(staffAppId && nameFieldId && availabilityFieldId);
}

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

/** 環境変数の uniqueId を優先し、解決できなければ見出し名で探す */
function resolveSchemaFieldIdWithCaptionFallback(
  configuredId: string | undefined,
  fields: AtPocketFieldRow[],
  captionAlts: string[],
): string | null {
  const fromEnv = configuredId?.trim();
  if (fromEnv) {
    const resolved = resolveConfiguredFieldToSchemaUniqueId(fromEnv, fields);
    if (resolved) return resolved;
  }
  const picked = pickFieldUniqueIdByCaptions(fields, captionAlts);
  if (!picked) return null;
  return resolveConfiguredFieldToSchemaUniqueId(picked, fields) ?? picked;
}

async function resolveConstructionHandlerStaffConfig(): Promise<
  | { ok: true; cfg: ConstructionHandlerStaffConfig }
  | { ok: false; error: string }
> {
  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const nameFieldIdEnv = process.env.STAFF_NAME_FIELD_ID?.trim();
  const availabilityFieldIdEnv =
    process.env.STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID?.trim();
  if (!staffAppId || !nameFieldIdEnv || !availabilityFieldIdEnv) {
    return {
      ok: false,
      error:
        "STAFF_APP_ID・STAFF_NAME_FIELD_ID・STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID が未設定です。",
    };
  }

  const auth = { apiKey: apiKeyForStaffPocketReadApClList() };
  const fieldsCtx: AtPocketRequestContext = {
    operation: "calendar:工事対応者(列定義)",
    appEnv: "STAFF_APP_ID",
  };
  const appFields = await fetchAppFields(staffAppId, auth, fieldsCtx);

  const nameFieldId = resolveSchemaFieldIdWithCaptionFallback(
    nameFieldIdEnv,
    appFields,
    ["社員名", "氏名", "担当者名", "スタッフ名", "名前"],
  );
  const availabilityFieldId = resolveSchemaFieldIdWithCaptionFallback(
    availabilityFieldIdEnv,
    appFields,
    [
      "工事対応稼働状況",
      "工事対応 稼働状況",
      "工事対応稼働",
      "工事稼働状況",
    ],
  );

  if (!nameFieldId || !availabilityFieldId) {
    return {
      ok: false,
      error:
        "スタッフ名簿の氏名列または工事対応稼働状況列を解決できません。環境変数と @pocket の列見出しを確認してください。",
    };
  }

  const activeLabel =
    process.env.STAFF_CONSTRUCTION_AVAILABILITY_ACTIVE_LABEL?.trim() ||
    "稼働";

  return {
    ok: true,
    cfg: {
      staffAppId,
      nameFieldId,
      availabilityFieldId,
      activeLabel,
    },
  };
}

/**
 * 工事対応稼働が「稼働」でなくても候補に残す氏名。
 * 環境変数 STAFF_CONSTRUCTION_HANDLER_ALWAYS_INCLUDE_NAMES（カンマ区切り）で追加可能。
 */
function constructionHandlerAlwaysIncludeNames(): Set<string> {
  const defaults = ["冨田菜摘"];
  const fromEnv =
    process.env.STAFF_CONSTRUCTION_HANDLER_ALWAYS_INCLUDE_NAMES?.trim() ?? "";
  const names = [
    ...defaults,
    ...fromEnv.split(/[,、]/).map((s) => s.trim()),
  ];
  return new Set(names.map((n) => nfkcNormalize(n)).filter(Boolean));
}

function isAlwaysIncludedHandlerName(name: string): boolean {
  const key = nfkcNormalize(name);
  if (!key) return false;
  return constructionHandlerAlwaysIncludeNames().has(key);
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

function readAvailabilityRaw(
  ro: Record<string, unknown>,
  availabilityFieldId: string,
): unknown {
  const primary = pickRecordValueByFieldAliases(ro, availabilityFieldId);
  if (primary !== undefined && primary !== null && primary !== "") {
    return primary;
  }
  // 環境変数 ID と一覧レスポンスのキーがズレたとき用に、見出しっぽいキーも試す
  for (const key of Object.keys(ro)) {
    const lower = key.normalize("NFKC").toLowerCase();
    if (
      lower.includes("工事対応") &&
      (lower.includes("稼働") || lower.includes("availability"))
    ) {
      return ro[key];
    }
  }
  return primary;
}

/** 工事対応が「稼働」のスタッフ＋常時含める氏名。表示ラベルは同名時に社員 ID などで区別 */
export async function fetchConstructionHandlerStaffCandidates(): Promise<
  ConstructionHandlerStaffCandidate[]
> {
  const resolved = await resolveConstructionHandlerStaffConfig();
  if (!resolved.ok) return [];
  const cfg = resolved.cfg;

  const importKeyId = staffImportKeyFieldIdResolved();
  const rows = await fetchStaffRosterRowsCached();

  const picked: Array<{
    staffRecordId: string;
    name: string;
    importKey?: string;
  }> = [];

  for (const row of rows) {
    const id =
      row.recordId != null ? String(row.recordId) : row.uniqueId ?? "";
    const rec = row.record;
    if (!id || !rec || typeof rec !== "object") continue;
    const ro = rec as Record<string, unknown>;
    const name = pocketTableCellToPlainString(
      pickRecordValueByFieldAliases(ro, cfg.nameFieldId),
    );
    if (!name) continue;
    const active = staffConstructionAvailabilityIsActive(
      readAvailabilityRaw(ro, cfg.availabilityFieldId),
      cfg.activeLabel,
    );
    if (!active && !isAlwaysIncludedHandlerName(name)) continue;
    const importKey = importKeyId
      ? readStaffImportKeyFromRawRecord(ro)
      : undefined;
    picked.push({
      staffRecordId: id,
      name,
      ...(importKey ? { importKey } : {}),
    });
  }

  picked.sort((a, b) => a.name.localeCompare(b.name, "ja"));

  const nameCount = new Map<string, number>();
  for (const p of picked) {
    nameCount.set(p.name, (nameCount.get(p.name) ?? 0) + 1);
  }

  return picked.map((p) => {
    let label = p.name;
    if ((nameCount.get(p.name) ?? 0) > 1) {
      label = p.importKey
        ? `${p.name}（社員ID: ${p.importKey}）`
        : `${p.name}（レコードID: ${p.staffRecordId}）`;
    }
    return { staffRecordId: p.staffRecordId, name: p.name, label };
  });
}

export async function resolveConstructionHandlerNameForActiveStaff(
  staffRecordId: string,
): Promise<
  | { ok: true; name: string }
  | { ok: false; reason: "not_configured" | "not_found" | "no_name" | "not_active" }
> {
  const resolved = await resolveConstructionHandlerStaffConfig();
  if (!resolved.ok) return { ok: false, reason: "not_configured" };
  const cfg = resolved.cfg;

  const csv = uniqueFieldsCsv(cfg.nameFieldId, cfg.availabilityFieldId);
  const staffAuth = { apiKey: apiKeyForStaffPocketReadApClList() };
  const row = await fetchRecordById(
    cfg.staffAppId,
    staffRecordId,
    staffAuth,
    csv,
  );
  if (!row?.record || typeof row.record !== "object") {
    return { ok: false, reason: "not_found" };
  }
  const rec = row.record as Record<string, unknown>;
  const name = pocketTableCellToPlainString(
    pickRecordValueByFieldAliases(rec, cfg.nameFieldId),
  );
  if (!name) return { ok: false, reason: "no_name" };
  const active = staffConstructionAvailabilityIsActive(
    readAvailabilityRaw(rec, cfg.availabilityFieldId),
    cfg.activeLabel,
  );
  if (!active && !isAlwaysIncludedHandlerName(name)) {
    return { ok: false, reason: "not_active" };
  }
  return { ok: true, name };
}
