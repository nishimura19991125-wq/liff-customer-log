import { NextResponse } from "next/server";

import { isValidEmptyFillHousingStatus } from "@/lib/calendar-empty-fill-options";
import { createRecord } from "@/lib/atpocket";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import {
  constructionRegistrantStaffConfigReady,
  resolveRegistrantNameForActiveStaff,
} from "@/lib/staff-registrant-candidates";

export const dynamic = "force-dynamic";

type Body = {
  customerName?: string;
  housingStatus?: string;
  constructionRegistrantStaffRecordId?: string;
};

/**
 * 工事アプリに新規レコードを追加（空枠更新と同じフィールド設定を利用）。
 * T番号はリクエストに含めず、@pocket の自動採番に任せる。
 */
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
          "登録先フィールドが未設定です。.env に CALENDAR_EMPTY_FILL_CUSTOMER_NAME_FIELD_ID と CALENDAR_EMPTY_FILL_HOUSING_STATUS_FIELD_ID を設定してください。",
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

  const customerName = body.customerName?.trim();
  const housingRaw = body.housingStatus?.trim() ?? "";
  const constructionRegistrantStaffRecordId =
    body.constructionRegistrantStaffRecordId?.trim() ?? "";

  if (!customerName || !housingRaw) {
    return NextResponse.json(
      { error: "お客様名・住宅ステータスはすべて必須です" },
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

  const registrantField =
    process.env.CALENDAR_EMPTY_FILL_CONSTRUCTION_REGISTRANT_FIELD_ID?.trim();

  let registrantPutValue: string | undefined;

  if (registrantField) {
    if (!constructionRegistrantStaffConfigReady()) {
      return NextResponse.json(
        {
          error:
            "工事登録者はスタッフ名簿と連携する必要があります。STAFF_APP_ID・STAFF_NAME_FIELD_ID・STAFF_CONSTRUCTION_AVAILABILITY_FIELD_ID を設定してください。",
        },
        { status: 503 },
      );
    }
    if (!constructionRegistrantStaffRecordId) {
      return NextResponse.json(
        { error: "工事登録者を一覧から選択してください" },
        { status: 400 },
      );
    }
    const resolvedName = await resolveRegistrantNameForActiveStaff(
      constructionRegistrantStaffRecordId,
    );
    if (!resolvedName.ok) {
      const msg =
        resolvedName.reason === "not_found"
          ? "選択したスタッフが見つかりません。"
          : resolvedName.reason === "not_active"
            ? "選択した社員は工事対応が「稼働」ではありません。一覧を更新して選び直してください。"
            : resolvedName.reason === "no_name"
              ? "スタッフ名簿に氏名が入っていません。"
              : "工事登録者を検証できませんでした。";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    registrantPutValue = resolvedName.name;
  }

  const record: Record<string, unknown> = {
    [customerField]: customerName,
    [housingField]: housingRaw,
  };
  if (registrantField && registrantPutValue) {
    record[registrantField] = registrantPutValue;
  }

  try {
    await createRecord(calAppId, record);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/calendar/create-record]", e);
    return NextResponse.json(
      {
        error:
          "レコードの登録に失敗しました。APIキーの登録権限や@pocketの必須項目を確認してください。",
      },
      { status: 502 },
    );
  }
}
