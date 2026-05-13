import { NextResponse } from "next/server";

import { fetchAllRecordsPages } from "@/lib/atpocket";
import { formatStaffEmployeeIdForApi } from "@/lib/staff-employee-id-format";
import {
  staffConstructionAvailabilityIsActive,
} from "@/lib/staff-construction-availability";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { staffImportKeyFieldIdResolved } from "@/lib/staff-import-key";

export const dynamic = "force-dynamic";

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
 * 工事空枠の「工事対応者」プルダウン用。
 * スタッフ名簿アプリで「工事対応稼働状況」が稼働のレコードの社員名のみ返す。
 * STAFF_IMPORT_KEY_FIELD_ID 等で取込キー「社員ID」列が解決できるときは employeeId も返し、保存時はレコード ID に変換できる。
 */
export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const nameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim();
  const availabilityFieldId =
    process.env.STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID?.trim();
  const activeLabel =
    process.env.STAFF_CONSTRUCTION_AVAILABILITY_ACTIVE_LABEL?.trim() || "稼働";

  if (!staffAppId || !nameFieldId || !availabilityFieldId) {
    return NextResponse.json(
      {
        error:
          "工事対応者リスト用の環境変数が不足しています。STAFF_APP_ID・STAFF_NAME_FIELD_ID・STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID を設定してください。",
        handlers: [],
      },
      { status: 503 },
    );
  }

  const importKeyFieldId = staffImportKeyFieldIdResolved();
  const fieldsCsv = uniqueFieldsCsv(
    nameFieldId,
    availabilityFieldId,
    importKeyFieldId,
  );
  if (!fieldsCsv) {
    return NextResponse.json(
      { error: "フィールド ID が不正です", handlers: [] },
      { status: 500 },
    );
  }

  try {
    const rows = await fetchAllRecordsPages(staffAppId, fieldsCsv);
    const handlers: {
      staffRecordId: string;
      name: string;
      employeeId?: string;
    }[] = [];
    const seenId = new Set<string>();
    for (const row of rows) {
      const rec = row.record;
      if (!rec || typeof rec !== "object") continue;
      const rawStatus = rec[availabilityFieldId];
      if (!staffConstructionAvailabilityIsActive(rawStatus, activeLabel))
        continue;
      const rawName = rec[nameFieldId];
      if (rawName === undefined || rawName === null) continue;
      const name = String(rawName).trim();
      if (!name) continue;
      const ridNum = row.recordId ?? row.id;
      const staffRecordId =
        ridNum != null
          ? String(ridNum)
          : String(row.uniqueId ?? "").trim();
      if (!staffRecordId || seenId.has(staffRecordId)) continue;
      seenId.add(staffRecordId);
      let employeeId: string | undefined;
      if (importKeyFieldId) {
        const empFormatted = formatStaffEmployeeIdForApi(rec[importKeyFieldId]);
        if (empFormatted) employeeId = empFormatted;
      }
      handlers.push({
        staffRecordId,
        name,
        ...(employeeId ? { employeeId } : {}),
      });
    }
    handlers.sort((a, b) => {
      const c = a.name.localeCompare(b.name, "ja");
      return c !== 0 ? c : a.staffRecordId.localeCompare(b.staffRecordId);
    });
    return NextResponse.json({ handlers });
  } catch (e) {
    console.error("[api/calendar/construction-handlers]", e);
    return NextResponse.json(
      {
        error: "工事対応者リストの取得に失敗しました",
        handlers: [],
      },
      { status: 502 },
    );
  }
}
