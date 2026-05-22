import "server-only";

import { fetchRecordsList } from "@/lib/atpocket";
import { staffRecordMatchesLineUser } from "@/lib/staff-line-binding";
import {
  staffLineBindingEnabled,
  staffLineUserIdFieldIdsFromEnv,
} from "@/lib/staff-line-field-config";

/** LINE 紐付け済みスタッフの担当者名（名簿の「担当者名」列） */
export async function resolveBoundStaffNameForLineUser(
  lineUserId: string,
): Promise<string | null> {
  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const staffNameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim();
  if (!staffAppId || !staffNameFieldId) return null;

  const lineIds = staffLineUserIdFieldIdsFromEnv();
  if (!staffLineBindingEnabled(lineIds)) return null;

  const data = await fetchRecordsList(staffAppId, {
    limit: "1000",
    page: "1",
  });
  const rows = data.records ?? [];

  for (const row of rows) {
    const rec = row.record;
    if (!rec || typeof rec !== "object") continue;
    const rawName = (rec as Record<string, unknown>)[staffNameFieldId];
    const name =
      rawName === undefined || rawName === null ? "" : String(rawName).trim();
    if (!name) continue;
    if (
      staffRecordMatchesLineUser(
        rec as Record<string, unknown>,
        lineIds.lineField1,
        lineIds.lineField2,
        lineUserId,
      )
    ) {
      return name;
    }
  }

  return null;
}
