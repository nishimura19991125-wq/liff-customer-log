import "server-only";

import { NextResponse } from "next/server";

import { LINE_SESSION_EXPIRED_CODE } from "@/lib/line-auth-codes";
import {
  LineIdTokenExpiredError,
  verifyLineIdTokenCached,
} from "@/lib/line-verify";

export type ResolveCallerLineAuthResult =
  | { ok: true; lineUserId: string }
  | {
      ok: false;
      reason: "no_bearer" | "no_channel" | "token_expired" | "token_invalid";
    };

export async function resolveCallerLineAuth(
  request: Request,
): Promise<ResolveCallerLineAuthResult> {
  const authz = request.headers.get("authorization");
  const bearer =
    authz?.startsWith("Bearer ") ? authz.slice("Bearer ".length).trim() : "";

  if (!bearer) return { ok: false, reason: "no_bearer" };

  const channelId = process.env.LINE_LOGIN_CHANNEL_ID?.trim();
  if (!channelId) return { ok: false, reason: "no_channel" };

  try {
    const { sub } = await verifyLineIdTokenCached(bearer, channelId);
    return { ok: true, lineUserId: sub };
  } catch (e) {
    if (e instanceof LineIdTokenExpiredError) {
      return { ok: false, reason: "token_expired" };
    }
    return { ok: false, reason: "token_invalid" };
  }
}

/** 検証に成功したときのみ LINE ユーザー ID を返す（期限切れ・不正は null） */
export async function resolveCallerLineUserId(
  request: Request,
): Promise<{ lineUserId: string } | null> {
  const r = await resolveCallerLineAuth(request);
  return r.ok ? { lineUserId: r.lineUserId } : null;
}

export function lineAuthUnauthorizedResponse(
  failure: Extract<ResolveCallerLineAuthResult, { ok: false }>,
): NextResponse {
  if (failure.reason === "token_expired") {
    return NextResponse.json(
      {
        error:
          "ログインの有効期限が切れました。画面を更新して再度ログインしてください。",
        code: LINE_SESSION_EXPIRED_CODE,
      },
      { status: 401 },
    );
  }
  return NextResponse.json(
    { error: "認証が必要です", code: "LINE_AUTH_REQUIRED" },
    { status: 401 },
  );
}
