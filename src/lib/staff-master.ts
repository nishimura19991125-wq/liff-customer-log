import { fetchRecordById } from "@/lib/atpocket";

/** 担当者マスタからレコード ID に対応する表示名だけをサーバー側で解決（クライアント改ざん防止） */
export async function resolveStaffDisplayNameFromMaster(
  staffAppId: string,
  staffNameFieldId: string,
  staffRecordId: string,
): Promise<string | null> {
  const row = await fetchRecordById(staffAppId, staffRecordId);
  const raw = row?.record?.[staffNameFieldId];
  if (raw === undefined || raw === null) return null;
  const name = String(raw).trim();
  return name || null;
}
