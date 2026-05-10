import "server-only";

import { verifyLineIdToken } from "@/lib/line-verify";

/** Bearer の LINE ID トークンを検証し `sub`（ユーザー ID）を返す */
export async function resolveCallerLineUserId(
  request: Request,
): Promise<{ lineUserId: string } | null> {
  const authz = request.headers.get("authorization");
  const bearer =
    authz?.startsWith("Bearer ") ? authz.slice("Bearer ".length).trim() : "";

  if (!bearer) return null;

  const channelId = process.env.LINE_LOGIN_CHANNEL_ID?.trim();
  if (!channelId) return null;

  try {
    const { sub } = await verifyLineIdToken(bearer, channelId);
    return { lineUserId: sub };
  } catch {
    return null;
  }
}
