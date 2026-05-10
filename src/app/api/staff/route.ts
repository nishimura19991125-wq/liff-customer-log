import { NextResponse } from "next/server";

import {
  fetchFieldsList,
  fetchRecordsList,
  resolveUniqueIdByCaption,
} from "@/lib/atpocket";
import { resolveCallerLineUserId } from "@/lib/request-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const caller = await resolveCallerLineUserId(request);
  if (!caller) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const staffNameCaption = process.env.STAFF_NAME_CAPTION?.trim();

  if (!staffAppId || !staffNameCaption) {
    return NextResponse.json(
      {
        error:
          "STAFF_APP_ID または STAFF_NAME_CAPTION（担当者名の見出し）が未設定です",
      },
      { status: 500 },
    );
  }

  try {
    const fieldMeta = await fetchFieldsList(staffAppId);
    const nameFieldKey = resolveUniqueIdByCaption(
      fieldMeta.fields ?? [],
      staffNameCaption,
    );

    const data = await fetchRecordsList(staffAppId);
    const rows = data.records ?? [];

    const staff = rows
      .map((row) => {
        const id = row.recordId != null ? String(row.recordId) : row.uniqueId ?? "";
        const raw = row.record?.[nameFieldKey];
        const name =
          raw === undefined || raw === null ? "" : String(raw).trim();
        return { id, name };
      })
      .filter((s) => s.id && s.name);

    return NextResponse.json({ staff });
  } catch (e) {
    console.error("[api/staff]", e);
    const message =
      e instanceof Error ? e.message : "担当者一覧の取得に失敗しました";
    const isCaptionConfig =
      message.startsWith("見出し") ||
      message.includes("uniqueId") ||
      message.includes("重複") ||
      message.includes("Caption label");
    const clientMsg = isCaptionConfig
      ? message
      : "担当者一覧の取得に失敗しました";
    return NextResponse.json(
      { error: clientMsg },
      { status: isCaptionConfig ? 500 : 502 },
    );
  }
}
