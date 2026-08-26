import { NextResponse } from "next/server";

import { pocketErrorResponse } from "@/lib/api-error-response";

import {
  saveApoAttachmentSharedLink,
  storeApoAttachmentFile,
} from "@/lib/apo-attachment-upload";
import {
  APO_ATTACHMENT_MAX_BYTES,
  checkApoAttachmentType,
} from "@/lib/apo-attachment";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { resolveBoundStaffNameForLineUser } from "@/lib/staff-bound-lookup";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ recordId: string }> };

/**
 * アポ資料（立面図・平面図）の添付を1件受け取り、Dropbox へ置く。
 *
 * ■ 1リクエスト1ファイル
 * レコード本文に base64 で同梱すると 5MB×5件で 33MB ほどになり、
 * 本文サイズの上限に当たる。お客様情報の書類アップロードと同じく
 * multipart で1件ずつ受ける（1リクエストは 5MB 以内に収まる）。
 *
 * ■ 形式の検証
 * クライアントの accept 属性は選択ダイアログの絞り込みでしかない。
 * ここで拡張子・MIME・先頭バイトを突き合わせる。
 */
export async function POST(request: Request, ctx: RouteCtx) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const boundStaffName = await resolveBoundStaffNameForLineUser(auth.lineUserId);
  if (!boundStaffName) {
    return NextResponse.json(
      { error: "担当者の紐付けが必要です", needsStaffBind: true },
      { status: 403 },
    );
  }

  const { recordId: recordIdRaw } = await ctx.params;
  const recordId = recordIdRaw?.trim();
  if (!recordId) {
    return NextResponse.json({ error: "recordId が必要です" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "multipart/form-data で送信してください" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "ファイルが選択されていません" },
      { status: 400 },
    );
  }

  if (file.size <= 0) {
    return NextResponse.json({ error: "空のファイルです" }, { status: 400 });
  }
  if (file.size > APO_ATTACHMENT_MAX_BYTES) {
    const mb = Math.floor(APO_ATTACHMENT_MAX_BYTES / 1_000_000);
    return NextResponse.json(
      {
        error: `ファイルサイズが大きすぎます（上限${mb}MB）。分割するか、画質を下げて再撮影してください。`,
      },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // 拡張子 → MIME → 先頭バイトの順に見る
  const typeCheck = checkApoAttachmentType({
    fileName: file.name ?? "",
    mimeType: file.type ?? "",
    head: bytes.subarray(0, 8),
  });
  if (!typeCheck.ok) {
    return NextResponse.json(
      {
        error:
          "対応していないファイル形式です（PDF・JPG・PNG のみ送信できます）",
      },
      { status: 415 },
    );
  }

  try {
    const result = await storeApoAttachmentFile({
      recordId,
      boundStaffName,
      extension: typeCheck.extension,
      bytes,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }
    return NextResponse.json({
      ok: true,
      fileName: result.fileName,
      // 共有リンクの保存に失敗しても添付は済んでいる。画面で伝え分ける
      linkSaved: result.linkSaved,
    });
  } catch (e) {
    return pocketErrorResponse(e, {
      scope: "api/apo-acquisition/attachments",
      message: "添付の保存に失敗しました",
    });
  }
}

/**
 * 共有リンクだけを貼り直す。
 *
 * 添付そのものは通ったのにリンクの保存だけ落ちた場合に使う。
 * ファイルを受け取らないので multipart ではなく本文なしの PUT。
 */
export async function PUT(request: Request, ctx: RouteCtx) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  const boundStaffName = await resolveBoundStaffNameForLineUser(auth.lineUserId);
  if (!boundStaffName) {
    return NextResponse.json(
      { error: "担当者の紐付けが必要です", needsStaffBind: true },
      { status: 403 },
    );
  }

  const { recordId: recordIdRaw } = await ctx.params;
  const recordId = recordIdRaw?.trim();
  if (!recordId) {
    return NextResponse.json({ error: "recordId が必要です" }, { status: 400 });
  }

  try {
    const result = await saveApoAttachmentSharedLink({
      recordId,
      boundStaffName,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return pocketErrorResponse(e, {
      scope: "api/apo-acquisition/attachments",
      message: "共有リンクの保存に失敗しました",
    });
  }
}
