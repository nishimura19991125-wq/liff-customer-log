import { NextResponse } from "next/server";

import {
  clearPinFailures,
  isPinLocked,
  pinActorTag,
  recordPinFailure,
} from "@/lib/pin-attempt-limiter";
import {
  lineAuthUnauthorizedResponse,
  resolveCallerLineAuth,
} from "@/lib/request-auth";
import {
  resolveBoundStaffPinContext,
  verifyStaffPin,
} from "@/lib/staff-pin-server";

export const dynamic = "force-dynamic";

/** ロック中の応答。残り試行回数・解除時刻は返さない（総当たりの補助情報になる） */
const LOCKED_RESPONSE = {
  error:
    "暗証番号の入力に複数回失敗したため、一時的にロックされています。しばらく時間をおいてから再度お試しください。",
} as const;

export async function POST(request: Request) {
  const auth = await resolveCallerLineAuth(request);
  if (!auth.ok) return lineAuthUnauthorizedResponse(auth);

  if (isPinLocked(auth.lineUserId)) {
    return NextResponse.json(LOCKED_RESPONSE, { status: 429 });
  }

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

  if (!pin) {
    return NextResponse.json({ error: "暗証番号が必要です" }, { status: 400 });
  }

  try {
    const ctx = await resolveBoundStaffPinContext(auth.lineUserId);
    if (!ctx.ok) {
      return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    }

    const result = await verifyStaffPin(ctx, pin);
    if (!result.ok) {
      // 初期設定が必要なだけの場合は入力ミスではないので回数に数えない
      if (result.needsInitialSetup) {
        return NextResponse.json(
          { error: result.error, needsInitialSetup: true },
          { status: 403 },
        );
      }

      const { failures, locked } = recordPinFailure(auth.lineUserId);
      // 出力してよいのは userId のハッシュ先頭8桁・時刻・失敗回数のみ。
      // PIN の値・氏名・生の userId は出さない。
      console.warn(
        `[api/staff/pin/verify] PIN 認証失敗 actor=${pinActorTag(
          auth.lineUserId,
        )} at=${new Date().toISOString()} failures=${failures}${
          locked ? " locked=true" : ""
        }`,
      );

      if (locked) {
        return NextResponse.json(LOCKED_RESPONSE, { status: 429 });
      }
      return NextResponse.json({ error: result.error }, { status: 401 });
    }

    clearPinFailures(auth.lineUserId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/staff/pin/verify]", e);
    return NextResponse.json(
      { error: "暗証番号の確認に失敗しました" },
      { status: 502 },
    );
  }
}
