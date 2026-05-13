import { NextResponse } from "next/server";

import { isValidEmptyFillHousingStatus } from "@/lib/calendar-empty-fill-options";
import {
  constructionTitleFieldIsEmpty,
  resolveConstructionFieldIds,
} from "@/lib/calendar-kojo";
import {
  apiKeyForCalendarPocket,
  fetchAppFields,
  fetchRecordById,
  updateRecord,
} from "@/lib/atpocket";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";

export const dynamic = "force-dynamic";

type Body = {
  recordId?: string;
  customerName?: string;
  housingStatus?: string;
};

/** GET/PUT に載せるフィールドはこの3つのみ（それ以外を PUT すると「有効なフィールドではありません」になることがある） */
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

export async function POST(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const calAppId = process.env.CALENDAR_APP_ID?.trim();
  if (!calAppId) {
    return NextResponse.json(
      { error: "CALENDAR_APP_ID が未設定です", disabled: true },
      { status: 503 },
    );
  }

  const customerField =
    process.env.CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID?.trim() ||
    process.env.CALENDAR_EMPTY_FILL_TITLE_FIELD_ID?.trim();
  const housingField =
    process.env.CALENDAR_EMPTY_FILL_HOUSING_STATUS_FIELD_ID?.trim();

  if (!customerField || !housingField) {
    return NextResponse.json(
      {
        error:
          "工事空枠の入力先フィールドが未設定です。.env に CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID と CALENDAR_EMPTY_FILL_HOUSING_STATUS_FIELD_ID（@pocket の uniqueId）を設定してください。",
      },
      { status: 500 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const recordId = body.recordId?.trim();
  const customerName = body.customerName?.trim();
  const housingRaw = body.housingStatus?.trim() ?? "";

  if (!recordId || !customerName || !housingRaw) {
    return NextResponse.json(
      { error: "recordId・お客様名・住宅ステータスはすべて必須です" },
      { status: 400 },
    );
  }

  if (!isValidEmptyFillHousingStatus(housingRaw)) {
    return NextResponse.json(
      {
        error:
          "住宅ステータスは「新築案件」または「既築案件」を指定してください",
      },
      { status: 400 },
    );
  }

  const pocketAuth = { apiKey: apiKeyForCalendarPocket() };

  try {
    const constructionFields = await fetchAppFields(calAppId, pocketAuth);
    const fids = resolveConstructionFieldIds(constructionFields);
    const tNumberField =
      process.env.CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID?.trim() ||
      fids.tNumber?.trim();

    if (!tNumberField) {
      return NextResponse.json(
        {
          error:
            "T番号フィールドの uniqueId が分かりません。CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID を .env に設定するか、アプリに「T番号」見出しのフィールドを用意してください。",
        },
        { status: 500 },
      );
    }

    const fieldsCsv = uniqueFieldsCsv(
      customerField,
      housingField,
      tNumberField,
    );

    let recRow: Awaited<ReturnType<typeof fetchRecordById>> = null;
    try {
      recRow = await fetchRecordById(
        calAppId,
        recordId,
        pocketAuth,
        fieldsCsv,
      );
    } catch {
      recRow = await fetchRecordById(calAppId, recordId, pocketAuth);
    }

    if (!recRow?.record || typeof recRow.record !== "object") {
      return NextResponse.json({ error: "レコードが見つかりません" }, { status: 404 });
    }

    const recObj = recRow.record as Record<string, unknown>;
    if (!constructionTitleFieldIsEmpty(recObj, customerField)) {
      return NextResponse.json(
        {
          error:
            "このレコードはお客様名が既に入っているため、工事空枠として更新できません",
        },
        { status: 409 },
      );
    }

    const existingT = recObj[tNumberField];
    if (existingT === undefined || existingT === null) {
      return NextResponse.json(
        {
          error:
            "このレコードから T番号 を取得できませんでした。@pocket で空枠に T番号 が入っているか、CALENDAR_EMPTY_FILL_TNUMBER_FIELD_ID が正しい uniqueId か確認してください。",
        },
        { status: 409 },
      );
    }

    /** PUT はこの3キーのみ（GET で返った T番号はそのままの形で送る） */
    const patch: Record<string, unknown> = {
      [tNumberField]: existingT,
      [customerField]: customerName,
      [housingField]: housingRaw,
    };

    await updateRecord(calAppId, recordId, patch, pocketAuth);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/calendar/fill-empty-slot]", e);
    return NextResponse.json(
      {
        error:
          "レコードの更新に失敗しました。しばらくしてから再度お試しください。",
      },
      { status: 502 },
    );
  }
}
