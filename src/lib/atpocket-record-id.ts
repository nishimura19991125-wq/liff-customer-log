import type { AtPocketRecordRow } from "@/lib/atpocket";

/** @pocket のレコード行から API 用 recordId（なければ uniqueId）を得る */
export function atPocketRecordIdFromRow(row: AtPocketRecordRow | null | undefined): string | null {
  if (!row) return null;
  if (row.recordId != null && String(row.recordId).trim()) {
    return String(row.recordId).trim();
  }
  if (row.id != null && String(row.id).trim()) {
    return String(row.id).trim();
  }
  const uid = row.uniqueId?.trim();
  return uid || null;
}
