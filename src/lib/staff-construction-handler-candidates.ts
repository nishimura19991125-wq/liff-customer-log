import "server-only";

import {
  fetchAllRecordsPages,
  fetchRecordById,
} from "@/lib/atpocket";
import {
  readStaffImportKeyFromRawRecord,
  staffImportKeyFieldIdResolved,
} from "@/lib/staff-import-key";
import {
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

export function constructionHandlerStaffConfigReady(): boolean {
  return constructionHandlerStaffConfig() !== null;
}

function constructionHandlerStaffConfig(): {
  staffAppId: string;
  nameFieldId: string;
  availabilityFieldId: string;
  activeLabel: string;
} | null {
  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const nameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim();
  const availabilityFieldId =
    process.env.STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID?.trim();
  if (!staffAppId || !nameFieldId || !availabilityFieldId) return null;
  const activeLabel =
    process.env.STAFF_CONSTRUCTION_AVAILABILITY_ACTIVE_LABEL?.trim() ||
    "稼働";
  return { staffAppId, nameFieldId, availabilityFieldId, activeLabel };
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

/** 工事対応が「稼働」のスタッフのみ。表示ラベルは同名時に社員 ID などで区別 */
export async function fetchConstructionHandlerStaffCandidates(): Promise<
  ConstructionHandlerStaffCandidate[]
> {
  const cfg = constructionHandlerStaffConfig();
  if (!cfg) return [];

  const importKeyId = staffImportKeyFieldIdResolved();
  const csv = uniqueFieldsCsv(
    cfg.nameFieldId,
    cfg.availabilityFieldId,
    importKeyId,
  );
  const rows = await fetchAllRecordsPages(cfg.staffAppId, csv);

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
    if (
      !staffConstructionAvailabilityIsActive(
        ro[cfg.availabilityFieldId],
        cfg.activeLabel,
      )
    ) {
      continue;
    }
    const name = pocketTableCellToPlainString(ro[cfg.nameFieldId]);
    if (!name) continue;
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
  const cfg = constructionHandlerStaffConfig();
  if (!cfg) return { ok: false, reason: "not_configured" };

  const csv = uniqueFieldsCsv(cfg.nameFieldId, cfg.availabilityFieldId);
  const row = await fetchRecordById(
    cfg.staffAppId,
    staffRecordId,
    undefined,
    csv,
  );
  if (!row?.record || typeof row.record !== "object") {
    return { ok: false, reason: "not_found" };
  }
  const rec = row.record as Record<string, unknown>;
  const name = pocketTableCellToPlainString(rec[cfg.nameFieldId]);
  if (!name) return { ok: false, reason: "no_name" };
  if (
    !staffConstructionAvailabilityIsActive(
      rec[cfg.availabilityFieldId],
      cfg.activeLabel,
    )
  ) {
    return { ok: false, reason: "not_active" };
  }
  return { ok: true, name };
}
