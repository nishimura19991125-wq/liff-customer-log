import { NextResponse } from "next/server";

import { fetchRecordsList } from "@/lib/atpocket";
import { resolveCallerLineUserId } from "@/lib/request-auth";

export const dynamic = "force-dynamic";

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

  try {
    const data = await fetchRecordsList(staffAppId);
    const rows = data.records ?? [];

    const staff = rows
      .map((row) => {
        const id = row.recordId != null ? String(row.recordId) : row.uniqueId ?? "";
        const raw = row.record?.[staffNameFieldId];
        const name =
          raw === undefined || raw === null ? "" : String(raw).trim();
        return { id, name };
      })
      .filter((s) => s.id && s.name);

    return NextResponse.json({ staff });
  } catch (e) {
    console.error("[api/staff]", e);
    return NextResponse.json(
      { error: "担当者一覧の取得に失敗しました" },
      { status: 502 },
    );
  }
}
