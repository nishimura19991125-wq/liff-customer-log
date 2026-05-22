import { NextResponse } from "next/server";

import { fetchRecordsList } from "@/lib/atpocket";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import {
  staffLineBindingConfigError,
  staffLineBindingEnabled,
  staffLineUserIdFieldIdsFromEnv,
} from "@/lib/staff-line-field-config";
import {
  readStaffImportKeyFromRawRecord,
  staffImportKeyFieldIdResolved,
} from "@/lib/staff-import-key";
import { staffRecordMatchesLineUser } from "@/lib/staff-line-binding";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);
  const caller = auth;
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
    const lineIds = staffLineUserIdFieldIdsFromEnv();
    const lineField1 = lineIds.lineField1;
    const lineField2 = lineIds.lineField2;
    const lineBindingOn = staffLineBindingEnabled(lineIds);
    const lineConfigError = staffLineBindingConfigError();

    /** LINE 照合用は fields 無指定でフル record を取得（fields 指定だと値が欠けることがある） */
    const data = await fetchRecordsList(staffAppId, {
      limit: "1000",
      page: "1",
      ...(!lineBindingOn && staffNameFieldId
        ? { fields: staffNameFieldId }
        : {}),
    });
    const rows = data.records ?? [];
    const includeImportKey = Boolean(staffImportKeyFieldIdResolved());

    const staff = rows
      .map((row) => {
        const id =
          row.recordId != null ? String(row.recordId) : row.uniqueId ?? "";
        const rec = row.record;
        const raw = rec?.[staffNameFieldId];
        const name =
          raw === undefined || raw === null ? "" : String(raw).trim();
        const importKey =
          includeImportKey &&
          rec &&
          typeof rec === "object"
            ? readStaffImportKeyFromRawRecord(rec as Record<string, unknown>)
            : undefined;
        return {
          id,
          name,
          ...(includeImportKey ? { importKey } : {}),
        };
      })
      .filter((s) => s.id && s.name);

    let boundStaff: { id: string; name: string } | null = null;
    if (lineBindingOn) {
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
            lineField2,
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
      bindingEnabled: lineBindingOn,
      ...(lineConfigError && !lineBindingOn
        ? { bindingConfigError: lineConfigError }
        : {}),
    });
  } catch (e) {
    console.error("[api/staff]", e);
    return NextResponse.json(
      { error: "担当者一覧の取得に失敗しました" },
      { status: 502 },
    );
  }
}
