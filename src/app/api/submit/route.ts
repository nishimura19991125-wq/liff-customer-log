import { NextResponse } from "next/server";

import { createRecord } from "@/lib/atpocket";
import { resolveCallerLineUserId } from "@/lib/request-auth";
import { resolveStaffDisplayNameFromMaster } from "@/lib/staff-master";

export const dynamic = "force-dynamic";

type SubmitBody = {
  staffRecordId?: string;
  customerName?: string;
  content?: string;
};

export async function POST(request: Request) {
  const caller = await resolveCallerLineUserId(request);
  if (!caller) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  let body: SubmitBody;
  try {
    body = (await request.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const staffAppId = process.env.STAFF_APP_ID?.trim();
  const staffNameFieldId = process.env.STAFF_NAME_FIELD_ID?.trim();
  const logAppId = process.env.LOG_APP_ID?.trim();
  const fieldLineUserId = process.env.LOG_FIELD_LINE_USER_ID?.trim();
  const fieldStaffName = process.env.LOG_FIELD_STAFF_NAME?.trim();
  const fieldCustomerName = process.env.LOG_FIELD_CUSTOMER_NAME?.trim();
  const fieldContent = process.env.LOG_FIELD_CONTENT?.trim();

  if (
    !staffAppId ||
    !staffNameFieldId ||
    !logAppId ||
    !fieldLineUserId ||
    !fieldStaffName ||
    !fieldCustomerName ||
    !fieldContent
  ) {
    return NextResponse.json(
      {
        error:
          "STAFF_APP_ID / STAFF_NAME_FIELD_ID / LOG_APP_ID / LOG_FIELD_* が未設定です",
      },
      { status: 500 },
    );
  }

  const staffRecordId = body.staffRecordId?.trim();
  const customerName = body.customerName?.trim();
  const content = body.content?.trim();

  if (!staffRecordId || !customerName || !content) {
    return NextResponse.json(
      { error: "staffRecordId, customerName, content はすべて必須です" },
      { status: 400 },
    );
  }

  try {
    const staffName = await resolveStaffDisplayNameFromMaster(
      staffAppId,
      staffNameFieldId,
      staffRecordId,
    );
    if (!staffName) {
      return NextResponse.json(
        { error: "担当者の指定が無効です" },
        { status: 400 },
      );
    }

    const record: Record<string, unknown> = {
      [fieldLineUserId]: caller.lineUserId,
      [fieldStaffName]: staffName,
      [fieldCustomerName]: customerName,
      [fieldContent]: content,
    };

    const fieldStaffRecordId =
      process.env.LOG_FIELD_STAFF_RECORD_ID?.trim();
    if (fieldStaffRecordId) {
      record[fieldStaffRecordId] = staffRecordId;
    }

    await createRecord(logAppId, record);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/submit]", e);
    const detail =
      e instanceof Error ? e.message.slice(0, 800) : String(e).slice(0, 800);
    return NextResponse.json(
      {
        error: "ログの登録に失敗しました",
        detail,
      },
      { status: 502 },
    );
  }
}
