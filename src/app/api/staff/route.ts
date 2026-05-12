import { NextResponse } from "next/server";

import { fetchRecordsList } from "@/lib/atpocket";
import { resolveCallerLineUserId } from "@/lib/request-auth";
import { staffRecordMatchesLineUser } from "@/lib/staff-line-binding";

export const dynamic = "force-dynamic";

function uniqueCsv(fields: string[]): string {
  return [...new Set(fields.map((s) => s.trim()).filter(Boolean))].join(",");
}

export async function GET(request: Request) {
  const caller = await resolveCallerLineUserId(request);
  if (!caller) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const staffNameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim();

  if (!staffAppId || !staffNameFieldId) {
    return NextResponse.json(
      {
        error:
          "STAFF_APP_ID または STAFF_NAME_FIELD_ID（担当者名のフィールド識別名）が未設定です",
      },
      { status: 500 },
    );
  }

  const lineField1 = process.env.STAFF_LINE_USER_ID_FIELD_ID?.trim();
  const lineField2 = process.env.STAFF_LINE_USER_ID_FIELD_ID_2?.trim();

  const fieldsCsv = uniqueCsv([
    staffNameFieldId,
    ...(lineField1 ? [lineField1] : []),
    ...(lineField2 ? [lineField2] : []),
  ]);

  try {
    const data = await fetchRecordsList(staffAppId, {
      limit: "1000",
      page: "1",
      ...(fieldsCsv ? { fields: fieldsCsv } : {}),
    });
    const rows = data.records ?? [];

    const staff = rows
      .map((row) => {
        const id =
          row.recordId != null ? String(row.recordId) : row.uniqueId ?? "";
        const raw = row.record?.[staffNameFieldId];
        const name =
          raw === undefined || raw === null ? "" : String(raw).trim();
        return { id, name };
      })
      .filter((s) => s.id && s.name);

    let boundStaff: { id: string; name: string } | null = null;
    if (lineField1) {
      for (const row of rows) {
        const rec = row.record;
        if (!rec || typeof rec !== "object") continue;
        const id =
          row.recordId != null ? String(row.recordId) : row.uniqueId ?? "";
        const rawName = rec[staffNameFieldId];
        const name =
          rawName === undefined || rawName === null
            ? ""
            : String(rawName).trim();
        if (!id || !name) continue;
        if (
          staffRecordMatchesLineUser(
            rec as Record<string, unknown>,
            lineField1,
            lineField2 || undefined,
            caller.lineUserId,
          )
        ) {
          boundStaff = { id, name };
          break;
        }
      }
    }

    return NextResponse.json({
      staff,
      boundStaff,
      lineUserId: caller.lineUserId,
      bindingEnabled: Boolean(lineField1),
    });
  } catch (e) {
    console.error("[api/staff]", e);
    return NextResponse.json(
      { error: "担当者一覧の取得に失敗しました" },
      { status: 502 },
    );
  }
}
