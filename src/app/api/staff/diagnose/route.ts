import { NextResponse } from "next/server";

import { fetchAppFields, fetchRecordsList } from "@/lib/atpocket";
import { resolveCallerLineUserId } from "@/lib/request-auth";
import { staffRecordMatchesLineUser } from "@/lib/staff-line-binding";

export const dynamic = "force-dynamic";

/**
 * スタッフ名簿のフィールド ID が @pocket で解決できるかを確認する（要 LINE 認証）。
 * レスポンスに機密値は含めず、uniqueId・件数・キー照合のみ。
 */
export async function GET(request: Request) {
  const caller = await resolveCallerLineUserId(request);
  if (!caller) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const staffNameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim();
  const lineField1 = process.env.STAFF_LINE_USER_ID_FIELD_ID?.trim();
  const lineField2 = process.env.STAFF_LINE_USER_ID_FIELD_ID_2?.trim();

  const base = {
    /** 検証済みトークンの sub（画面上の LINE ID と一致するか確認用） */
    lineLoginSub: caller.lineUserId,
    env: {
      STAFF_APP_ID_set: Boolean(staffAppId),
      STAFF_NAME_FIELD_ID: staffNameFieldId ?? null,
      STAFF_LINE_USER_ID_FIELD_ID: lineField1 ?? null,
      STAFF_LINE_USER_ID_FIELD_ID_2: lineField2 ?? null,
    },
  };

  if (!staffAppId || !staffNameFieldId) {
    return NextResponse.json({
      ...base,
      ok: false,
      message: "STAFF_APP_ID または STAFF_NAME_FIELD_ID が未設定です",
    });
  }

  try {
    const fields = await fetchAppFields(staffAppId);
    const schemaUniqueIds = new Set(
      fields.map((f) => f.uniqueId).filter((u): u is string => Boolean(u)),
    );

    const schemaCheck = {
      staffNameFieldId_inAppSchema: Boolean(
        staffNameFieldId && schemaUniqueIds.has(staffNameFieldId),
      ),
      lineField1_inAppSchema: Boolean(lineField1 && schemaUniqueIds.has(lineField1)),
      lineField2_inAppSchema: Boolean(
        lineField2 && schemaUniqueIds.has(lineField2),
      ),
    };

    const fieldCaptionByUniqueId = Object.fromEntries(
      fields
        .filter((f) => f.uniqueId)
        .map((f) => [f.uniqueId as string, f.caption ?? ""]),
    );

    const data = await fetchRecordsList(staffAppId, {
      limit: "1000",
      page: "1",
    });
    const rows = data.records ?? [];

    const distinctKeys = new Set<string>();
    let rowsWithNameKey = 0;
    let rowsWithLine1Key = 0;
    let rowsWithLine2Key = 0;
    let wouldBindToStaffName: string | null = null;

    for (const row of rows) {
      const rec = row.record;
      if (!rec || typeof rec !== "object") continue;
      const r = rec as Record<string, unknown>;
      for (const k of Object.keys(r)) distinctKeys.add(k);
      if (staffNameFieldId in r) rowsWithNameKey++;
      if (lineField1 && lineField1 in r) rowsWithLine1Key++;
      if (lineField2 && lineField2 in r) rowsWithLine2Key++;

      if (lineField1 && staffRecordMatchesLineUser(r, lineField1, lineField2, caller.lineUserId)) {
        const rawName = r[staffNameFieldId];
        const name =
          rawName === undefined || rawName === null
            ? ""
            : String(rawName).trim();
        if (name) wouldBindToStaffName = name;
      }
    }

    const keysSorted = [...distinctKeys].sort();
    const keysPreview =
      keysSorted.length > 200 ? keysSorted.slice(0, 200) : keysSorted;

    const hints: string[] = [];
    if (!schemaCheck.staffNameFieldId_inAppSchema) {
      hints.push(
        "STAFF_NAME_FIELD_ID がアプリのフィールド一覧にありません（タイポの可能性）。",
      );
    }
    if (lineField1 && !schemaCheck.lineField1_inAppSchema) {
      hints.push(
        "STAFF_LINE_USER_ID_FIELD_ID がアプリのフィールド一覧にありません。",
      );
    }
    if (lineField2 && !schemaCheck.lineField2_inAppSchema) {
      hints.push(
        "STAFF_LINE_USER_ID_FIELD_ID_2 がアプリのフィールド一覧にありません。",
      );
    }
    if (
      lineField1 &&
      schemaCheck.lineField1_inAppSchema &&
      rowsWithLine1Key === 0
    ) {
      hints.push(
        "スキーマには LINE 用フィールドがあるが、取得レコードにそのキーがありません（API キー権限・STAFF_APP_ID の誤りの可能性）。",
      );
    }

    return NextResponse.json({
      ...base,
      ok: true,
      schemaCheck,
      appSchemaUniqueIdsSample: [...schemaUniqueIds].sort().slice(0, 200),
      envFieldsCaptionHint: {
        [staffNameFieldId]: fieldCaptionByUniqueId[staffNameFieldId] ?? null,
        ...(lineField1
          ? { [lineField1]: fieldCaptionByUniqueId[lineField1] ?? null }
          : {}),
        ...(lineField2
          ? { [lineField2]: fieldCaptionByUniqueId[lineField2] ?? null }
          : {}),
      },
      recordsFetch: {
        rowCount: rows.length,
        rowsWithKey_STAFF_NAME_FIELD_ID: rowsWithNameKey,
        rowsWithKey_LINE_FIELD_1: lineField1 ? rowsWithLine1Key : null,
        rowsWithKey_LINE_FIELD_2: lineField2 ? rowsWithLine2Key : null,
      },
      distinctKeysOnRecords_sample: keysPreview,
      distinctKeysOnRecords_total: keysSorted.length,
      bindingProbe: {
        matchesExistingStaffRow: Boolean(wouldBindToStaffName),
        matchedStaffName: wouldBindToStaffName,
      },
      hints,
    });
  } catch (e) {
    console.error("[api/staff/diagnose]", e);
    return NextResponse.json(
      {
        ...base,
        ok: false,
        message: "@pocket の取得に失敗しました",
        errorDetail:
          typeof e === "object" && e !== null && "message" in e
            ? String((e as Error).message)
            : String(e),
      },
      { status: 502 },
    );
  }
}
