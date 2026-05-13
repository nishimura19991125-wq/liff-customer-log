import "server-only";

import { fetchAllRecordsPages, fetchRecordById, type AtPocketFetchAuth } from "@/lib/atpocket";
import {
  formatStaffEmployeeIdForApi,
  normalizeStaffEmployeeIdSearchInput,
} from "@/lib/staff-employee-id-format";
import { staffConstructionAvailabilityIsActive } from "@/lib/staff-construction-availability";
import { staffImportKeyFieldIdResolved } from "@/lib/staff-import-key";

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

/**
 * 工事対応者プルダウンで選んだ「社員ID」（取込キー列）から、スタッフ名簿のレコード ID を返す。
 * construction-handlers と同様、工事対応稼働状況が稼働の行に限定する。
 */
export async function resolveStaffRecordIdByEmployeeIdForConstructionHandler(opts: {
  staffAppId: string;
  employeeIdSearch: string;
  nameFieldId: string;
  availabilityFieldId: string;
  activeLabel: string;
}): Promise<string | null> {
  const keyField = staffImportKeyFieldIdResolved();
  if (!keyField) return null;
  const searchNorm = normalizeStaffEmployeeIdSearchInput(opts.employeeIdSearch);
  if (!searchNorm) return null;
  const fieldsCsv = uniqueFieldsCsv(
    keyField,
    opts.nameFieldId,
    opts.availabilityFieldId,
  );
  const rows = await fetchAllRecordsPages(opts.staffAppId, fieldsCsv);
  for (const row of rows) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    if (
      !staffConstructionAvailabilityIsActive(
        rec[opts.availabilityFieldId],
        opts.activeLabel,
      )
    ) {
      continue;
    }
    const cell = formatStaffEmployeeIdForApi(rec[keyField]);
    if (!cell || cell !== searchNorm) continue;
    const rid = row.recordId ?? row.id;
    if (rid == null) continue;
    return String(rid);
  }
  return null;
}

/** スタッフ名簿の1件 GET で取込キー「社員 ID」列のプレーン文字列を返す（工事対応者 ID フィールド向け PUT） */
export async function fetchStaffEmployeeIdByRecordId(
  staffAppId: string,
  staffRecordId: string,
  auth?: AtPocketFetchAuth,
): Promise<string | null> {
  const keyField = staffImportKeyFieldIdResolved();
  if (!keyField) return null;
  const row = await fetchRecordById(
    staffAppId,
    staffRecordId,
    auth,
    keyField,
  );
  const rec = row?.record;
  if (!rec || typeof rec !== "object") return null;
  const plain = formatStaffEmployeeIdForApi(rec[keyField]);
  return plain || null;
}
