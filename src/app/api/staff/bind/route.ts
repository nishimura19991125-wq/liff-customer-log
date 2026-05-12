import { NextResponse } from "next/server";

import {
  apiKeyForStaffWrite,
  fetchAppFieldUniqueIdsSetTryKeys,
  fetchRecordById,
  fetchRecordsList,
  pickRecordFieldsForSchema,
  stripLikelyInvalidPocketKeysFromRecord,
  updateRecord,
} from "@/lib/atpocket";
import { resolveCallerLineUserId } from "@/lib/request-auth";
import {
  enrichCleanedRecordWithImportKey,
  recordValueLooksPresent,
  staffImportKeyFieldIdEnv,
  staffRecordRefreshFieldsCsv,
} from "@/lib/staff-import-key";
import {
  resolveBindLineSlot,
  staffRecordMatchesLineUser,
} from "@/lib/staff-line-binding";

export const dynamic = "force-dynamic";

function rowId(row: {
  recordId?: number;
  uniqueId?: string;
}): string {
  return row.recordId != null ? String(row.recordId) : String(row.uniqueId ?? "");
}

export async function POST(request: Request) {
  const caller = await resolveCallerLineUserId(request);
  if (!caller) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON が不正です" }, { status: 400 });
  }

  const staffRecordIdRaw =
    typeof body === "object" &&
    body !== null &&
    "staffRecordId" in body &&
    typeof (body as { staffRecordId?: unknown }).staffRecordId === "string"
      ? (body as { staffRecordId: string }).staffRecordId.trim()
      : "";

  if (!staffRecordIdRaw) {
    return NextResponse.json(
      { error: "staffRecordId が必要です" },
      { status: 400 },
    );
  }

  const staffImportKeyBody =
    typeof body === "object" &&
    body !== null &&
    "staffImportKeyValue" in body &&
    typeof (body as { staffImportKeyValue?: unknown }).staffImportKeyValue ===
      "string"
      ? (body as { staffImportKeyValue: string }).staffImportKeyValue.trim()
      : "";

  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const staffNameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim();
  const lineField1 = process.env.STAFF_LINE_USER_ID_FIELD_ID?.trim();
  const lineField2 = process.env.STAFF_LINE_USER_ID_FIELD_ID_2?.trim();

  if (!staffAppId || !staffNameFieldId) {
    return NextResponse.json(
      {
        error:
          "STAFF_APP_ID または STAFF_NAME_FIELD_ID が未設定です",
      },
      { status: 500 },
    );
  }

  if (!lineField1) {
    return NextResponse.json(
      {
        error:
          "名前リストからの紐付けには STAFF_LINE_USER_ID_FIELD_ID の設定が必要です",
      },
      { status: 503 },
    );
  }

  const pocketAuth = { apiKey: apiKeyForStaffWrite() };

  try {
    const data = await fetchRecordsList(
      staffAppId,
      { limit: "1000", page: "1" },
      pocketAuth,
    );
    const rows = data.records ?? [];

    for (const row of rows) {
      const rec = row.record;
      if (!rec || typeof rec !== "object") continue;
      const id = rowId(row);
      if (!id || id === staffRecordIdRaw) continue;
      if (
        staffRecordMatchesLineUser(
          rec as Record<string, unknown>,
          lineField1,
          lineField2 || undefined,
          caller.lineUserId,
        )
      ) {
        return NextResponse.json(
          { error: "この LINE は別のスタッフに既に紐付けられています" },
          { status: 409 },
        );
      }
    }

    const target = rows.find((r) => rowId(r) === staffRecordIdRaw);
    const rec = target?.record;
    if (!rec || typeof rec !== "object") {
      return NextResponse.json(
        { error: "選択したスタッフが見つかりません" },
        { status: 404 },
      );
    }

    const recordFromList = rec as Record<string, unknown>;

    let recordObj = recordFromList;
    try {
      const fresh = await fetchRecordById(
        staffAppId,
        staffRecordIdRaw,
        pocketAuth,
      );
      if (fresh?.record && typeof fresh.record === "object") {
        recordObj = fresh.record as Record<string, unknown>;
      }
    } catch {
      /* 単体取得に失敗した場合は一覧の record で続行 */
    }

    const refreshCsv = staffRecordRefreshFieldsCsv({
      staffNameFieldId,
      lineField1,
      lineField2: lineField2 || undefined,
    });
    if (refreshCsv) {
      try {
        const partial = await fetchRecordById(
          staffAppId,
          staffRecordIdRaw,
          pocketAuth,
          refreshCsv,
        );
        if (partial?.record && typeof partial.record === "object") {
          recordObj = {
            ...recordObj,
            ...(partial.record as Record<string, unknown>),
          };
        }
      } catch {
        /* 続行 */
      }
    }

    const importKeyDest = staffImportKeyFieldIdEnv();
    if (importKeyDest && staffImportKeyBody) {
      recordObj = { ...recordObj, [importKeyDest]: staffImportKeyBody };
    }

    const rawName = recordObj[staffNameFieldId];
    const name =
      rawName === undefined || rawName === null ? "" : String(rawName).trim();
    if (!name) {
      return NextResponse.json(
        { error: "選択したスタッフに名前がありません" },
        { status: 404 },
      );
    }

    const slot = resolveBindLineSlot(
      recordObj,
      lineField1,
      lineField2 || undefined,
      caller.lineUserId,
    );

    if (slot.kind === "full") {
      return NextResponse.json(
        {
          error:
            "このスタッフの LINE 登録枠が埋まっています（1人あたり最大2件）",
        },
        { status: 409 },
      );
    }

    if (slot.kind === "already") {
      return NextResponse.json({
        ok: true,
        boundStaff: { id: staffRecordIdRaw, name },
      });
    }

    const cleanedRecord = enrichCleanedRecordWithImportKey(
      recordObj,
      stripLikelyInvalidPocketKeysFromRecord(recordObj),
    );

    const readKey = process.env.ATPOCKET_API_KEY?.trim() ?? "";
    const schemaUniqueIds = await fetchAppFieldUniqueIdsSetTryKeys(
      staffAppId,
      [readKey, apiKeyForStaffWrite()],
    );

    const picked =
      schemaUniqueIds != null && schemaUniqueIds.size > 0
        ? pickRecordFieldsForSchema(cleanedRecord, schemaUniqueIds)
        : cleanedRecord;

    const payload: Record<string, unknown> = {
      ...picked,
      [slot.fieldId]: slot.value,
    };

    /** フィールド一覧 API に載らない取込キー（社員ID 等）が pick で落ちるため、GET で返った値は追加する */
    for (const k of Object.keys(cleanedRecord)) {
      if (!(k in payload)) {
        payload[k] = cleanedRecord[k];
      }
    }

    const extraCsv = process.env.STAFF_BIND_ALWAYS_INCLUDE_FIELD_IDS?.trim();
    if (extraCsv) {
      for (const id of extraCsv.split(",").map((s) => s.trim()).filter(Boolean)) {
        if (id in cleanedRecord) {
          payload[id] = cleanedRecord[id];
        }
      }
    }
    payload[slot.fieldId] = slot.value;

    const importKeyId = staffImportKeyFieldIdEnv();
    if (importKeyId && !recordValueLooksPresent(payload[importKeyId])) {
      return NextResponse.json(
        {
          error:
            "スタッフの取込キー（社員ID）を更新用データに含められませんでした。Netlify で STAFF_IMPORT_KEY_FIELD_ID と STAFF_IMPORT_KEY_SOURCE_FIELD_IDS（例: field-5）を設定するか、@pocket で「社員ID」が取込設定のキーになっているか確認してください。",
        },
        { status: 503 },
      );
    }

    await updateRecord(staffAppId, staffRecordIdRaw, payload, pocketAuth);

    return NextResponse.json({
      ok: true,
      boundStaff: { id: staffRecordIdRaw, name },
    });
  } catch (e) {
    console.error("[api/staff/bind]", e);
    return NextResponse.json(
      { error: "スタッフ名簿の更新に失敗しました" },
      { status: 502 },
    );
  }
}
