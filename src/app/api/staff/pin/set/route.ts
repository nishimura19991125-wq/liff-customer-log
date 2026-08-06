import { NextResponse } from "next/server";

import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import { isResetApprovalApproved } from "@/lib/staff-pin-fields";
import {
  readStaffPinPublicState,
  resolveBoundStaffPinContext,
  setStaffInitialPin,
  setStaffPinAfterApproval,
} from "@/lib/staff-pin-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON が不正です" }, { status: 400 });
  }

  const pin =
    typeof body === "object" &&
    body !== null &&
    "pin" in body &&
    typeof (body as { pin?: unknown }).pin === "string"
      ? (body as { pin: string }).pin.trim()
      : "";

  // body.mode は後方互換のため受け取るが、**分岐には一切使わない**。
  // クライアントの申告で初期設定に分岐できると、承認フローを迂回して
  // 既存 PIN を上書きできてしまう。

  if (!pin) {
    return NextResponse.json({ error: "暗証番号が必要です" }, { status: 400 });
  }

  try {
    const ctx = await resolveBoundStaffPinContext(auth.lineUserId);
    if (!ctx.ok) {
      return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    }

    // 分岐の判断材料はサーバ側で読んだ状態のみ
    const state = await readStaffPinPublicState(ctx);

    if (state.needsInitialSetup) {
      const result = await setStaffInitialPin(ctx, pin);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    if (!isResetApprovalApproved(state.resetApproval)) {
      // 内部状態を推測させないよう固定文言にする
      return NextResponse.json(
        {
          error:
            "暗証番号の再設定には事務所の承認が必要です。事務所へ連絡してください。",
        },
        { status: 409 },
      );
    }

    const result = await setStaffPinAfterApproval(ctx, pin);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/staff/pin/set]", e);
    return NextResponse.json(
      { error: "暗証番号の登録に失敗しました" },
      { status: 502 },
    );
  }
}
