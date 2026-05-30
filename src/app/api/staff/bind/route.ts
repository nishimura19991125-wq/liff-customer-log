import { NextResponse } from "next/server";

import {
  apiKeyForStaffPocketRead,
  apiKeyForStaffPocketRead1,
  apiKeyForStaffWrite,
  fetchAppFieldUniqueIdsSetTryKeys,
  fetchRecordById,
  pickRecordFieldsForSchema,
  stripLikelyInvalidPocketKeysFromRecord,
  updateRecord,
} from "@/lib/atpocket";
import { invalidateApClStaffPickerCache } from "@/lib/staff-ap-cl-candidates";
import {
  fetchStaffRosterRowsCached,
  patchStaffRosterAfterLineBind,
} from "@/lib/staff-roster-cache";
import { resolveCallerLineAuth, lineAuthUnauthorizedResponse } from "@/lib/request-auth";
import {
  enrichCleanedRecordWithImportKey,
  pocketHyphenNumericFieldKeysToPreserveForStaffBind,
  recordValueLooksPresent,
  staffImportKeyFieldIdResolved,
  staffRecordRefreshFieldsCsv,
} from "@/lib/staff-import-key";
import {
  staffLineBindingConfigError,
  staffLineBindingEnabled,
  staffLineUserIdFieldIdsFromEnv,
} from "@/lib/staff-line-field-config";
import {
  resolveStaffGeneralAvailabilityConfig,
  staffRowGeneralAvailabilityIsActive,
} from "@/lib/staff-general-availability";
import {
  resolveBindLineSlot,
  staffRecordMatchesLineUser,
} from "@/lib/staff-line-binding";

export const dynamic = "force-dynamic";

function recordHasLegacyNumericFieldValues(raw: Record<string, unknown>): boolean {
  return Object.entries(raw).some(
    ([k, v]) => /^field-\d+$/i.test(k) && recordValueLooksPresent(v),
  );
}

function rowId(row: {
  recordId?: number;
  uniqueId?: string;
}): string {
  return row.recordId != null ? String(row.recordId) : String(row.uniqueId ?? "");
}

function parseInvalidFieldIdFromPocketError(msg: string): string | null {
  const m = msg.match(/指定されたフィールド\[([^\]]+)\]は有効なフィールドではありません。?/);
  return m?.[1]?.trim() || null;
}

async function updateRecordSkippingInvalidFields(params: {
  staffAppId: string;
  staffRecordIdRaw: string;
  payload: Record<string, unknown>;
  pocketAuth: { apiKey: string };
  requiredFieldIds: Set<string>;
}): Promise<void> {
  const { staffAppId, staffRecordIdRaw, payload, pocketAuth, requiredFieldIds } =
    params;
  const retryMax = 3;

  for (let i = 0; i < retryMax; i++) {
    try {
      await updateRecord(staffAppId, staffRecordIdRaw, payload, pocketAuth);
      return;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const invalidFieldId = parseInvalidFieldIdFromPocketError(msg);
      if (!invalidFieldId) throw error;
      if (requiredFieldIds.has(invalidFieldId)) throw error;
      if (!(invalidFieldId in payload)) throw error;
      delete payload[invalidFieldId];
      console.warn(
        `[api/staff/bind] dropped invalid field from update payload: ${invalidFieldId}`,
      );
    }
  }
  throw new Error("@pocket update record failed: invalid fields remained");
}

export async function POST(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);
  const caller = auth;
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
  if (!staffAppId || !staffNameFieldId) {
    return NextResponse.json(
      {
        error:
          "STAFF_APP_ID または STAFF_NAME_FIELD_ID が未設定です",
      },
      { status: 500 },
    );
  }

  const pocketAuth = { apiKey: apiKeyForStaffWrite() };

  try {
    const lineIds = staffLineUserIdFieldIdsFromEnv();
    const lineField1 = lineIds.lineField1;
    const lineField2 = lineIds.lineField2;
    if (!staffLineBindingEnabled(lineIds)) {
      return NextResponse.json(
        {
          error:
            staffLineBindingConfigError() ??
            "LINE 紐付け用の環境変数が未設定です",
        },
        { status: 503 },
      );
    }
    const rows = await fetchStaffRosterRowsCached();

    for (const row of rows) {
      const rec = row.record;
      if (!rec || typeof rec !== "object") continue;
      const id = rowId(row);
      if (!id || id === staffRecordIdRaw) continue;
      if (
        staffRecordMatchesLineUser(
          rec as Record<string, unknown>,
          lineField1,
          lineField2,
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

    const availabilityCfg = await resolveStaffGeneralAvailabilityConfig();
    if (availabilityCfg.ok) {
      if (
        !staffRowGeneralAvailabilityIsActive(
          recordFromList,
          availabilityCfg.cfg,
        )
      ) {
        return NextResponse.json(
          {
            error: `選択した社員は稼働状況が「${availabilityCfg.cfg.activeLabel}」ではありません。一覧を更新して選び直してください。`,
          },
          { status: 409 },
        );
      }
    }

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
      lineField2,
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

    const importKeyDest = staffImportKeyFieldIdResolved();
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
      lineField2,
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

    const schemaUniqueIds = await fetchAppFieldUniqueIdsSetTryKeys(
      staffAppId,
      [
        apiKeyForStaffPocketRead(),
        apiKeyForStaffPocketRead1(),
        apiKeyForStaffWrite(),
      ],
    );

    const preserveHyphen = pocketHyphenNumericFieldKeysToPreserveForStaffBind({
      staffNameFieldId,
      lineField1,
      lineField2,
    });
    if (schemaUniqueIds != null && schemaUniqueIds.size > 0) {
      for (const k of Object.keys(recordObj)) {
        if (/^field-\d+$/i.test(k) && schemaUniqueIds.has(k)) {
          preserveHyphen.add(k);
        }
      }
    }

    const cleanedRecord = enrichCleanedRecordWithImportKey(
      recordObj,
      stripLikelyInvalidPocketKeysFromRecord(recordObj, preserveHyphen),
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

    const importKeyId = staffImportKeyFieldIdResolved();
    if (importKeyId && !recordValueLooksPresent(payload[importKeyId])) {
      return NextResponse.json(
        {
          error:
            "スタッフの取込キー（社員ID）を更新用データに含められませんでした。管理画面の「社員ID」列のフィールド識別名（例: field-1）を STAFF_IMPORT_KEY_FIELD_ID に設定するか、STAFF_BIND_ALWAYS_INCLUDE_FIELD_IDS に field-1 だけを書いてください。@pocket の取込設定に「社員ID」がキーとして含まれているかも確認してください。",
        },
        { status: 503 },
      );
    }

    if (
      !staffImportKeyFieldIdResolved() &&
      recordHasLegacyNumericFieldValues(recordObj)
    ) {
      return NextResponse.json(
        {
          error:
            "レコードに field-数字 形式の列がありますが、取込キーを特定できません。STAFF_IMPORT_KEY_FIELD_ID に「社員ID」列の識別名を設定するか、STAFF_BIND_ALWAYS_INCLUDE_FIELD_IDS に field-1 などを含めてください。",
        },
        { status: 503 },
      );
    }

    const requiredFieldIds = new Set<string>([slot.fieldId]);
    if (importKeyId) requiredFieldIds.add(importKeyId);
    await updateRecordSkippingInvalidFields({
      staffAppId,
      staffRecordIdRaw,
      payload,
      pocketAuth,
      requiredFieldIds,
    });

    patchStaffRosterAfterLineBind({
      recordId: staffRecordIdRaw,
      lineFieldId: slot.fieldId,
      lineUserId: slot.value,
      recordSnapshot: payload,
    });
    invalidateApClStaffPickerCache();

    return NextResponse.json({
      ok: true,
      boundStaff: { id: staffRecordIdRaw, name },
    });
  } catch (e) {
    console.error("[api/staff/bind]", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("社員ID") && msg.includes("取込設定")) {
      return NextResponse.json(
        {
          error:
            "@pocket: 取込キー「社員ID」を認識できませんでした。「社員ID」列のフィールド識別名（画面どおり field-1 のことがあります）を STAFF_IMPORT_KEY_FIELD_ID または BIND に合わせ、@pocket の取込設定を確認してください。",
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "スタッフ名簿の更新に失敗しました" },
      { status: 502 },
    );
  }
}
