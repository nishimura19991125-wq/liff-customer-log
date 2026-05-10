import { NextResponse } from "next/server";

import {
  createRecord,
  fetchFieldsList,
  resolveUniqueIdByCaption,
} from "@/lib/atpocket";
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
  const staffNameCaption = process.env.STAFF_NAME_CAPTION?.trim();
  const logAppId = process.env.LOG_APP_ID?.trim();
  const captionLineUserId = process.env.LOG_CAPTION_LINE_USER_ID?.trim();
  const captionStaffName = process.env.LOG_CAPTION_STAFF_NAME?.trim();
  const captionCustomerName = process.env.LOG_CAPTION_CUSTOMER_NAME?.trim();
  const captionContent = process.env.LOG_CAPTION_CONTENT?.trim();

  if (
    !staffAppId ||
    !staffNameCaption ||
    !logAppId ||
    !captionLineUserId ||
    !captionStaffName ||
    !captionCustomerName ||
    !captionContent
  ) {
    return NextResponse.json(
      {
        error:
          "STAFF_APP_ID / STAFF_NAME_CAPTION / LOG_APP_ID / LOG_CAPTION_* が未設定です",
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
      staffNameCaption,
      staffRecordId,
    );
    if (!staffName) {
      return NextResponse.json(
        { error: "担当者の指定が無効です" },
        { status: 400 },
      );
    }

    const fieldMeta = await fetchFieldsList(logAppId);
    const roots = fieldMeta.fields ?? [];

    const lineField = resolveUniqueIdByCaption(roots, captionLineUserId);
    const staffField = resolveUniqueIdByCaption(roots, captionStaffName);
    const customerField = resolveUniqueIdByCaption(roots, captionCustomerName);
    const contentField = resolveUniqueIdByCaption(roots, captionContent);

    const record: Record<string, unknown> = {
      [lineField]: caller.lineUserId,
      [staffField]: staffName,
      [customerField]: customerName,
      [contentField]: content,
    };

    const captionStaffRecordId =
      process.env.LOG_CAPTION_STAFF_RECORD_ID?.trim();
    if (captionStaffRecordId) {
      const staffRecordField = resolveUniqueIdByCaption(
        roots,
        captionStaffRecordId,
      );
      record[staffRecordField] = staffRecordId;
    }

    await createRecord(logAppId, record);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/submit]", e);
    const message =
      e instanceof Error ? e.message : "ログの登録に失敗しました";
    const isCaptionConfig =
      message.startsWith("見出し") ||
      message.includes("uniqueId") ||
      message.includes("重複") ||
      message.includes("Caption label");
    const clientMsg = isCaptionConfig ? message : "ログの登録に失敗しました";
    return NextResponse.json(
      { error: clientMsg },
      { status: isCaptionConfig ? 500 : 502 },
    );
  }
}
