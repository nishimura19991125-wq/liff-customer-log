import "server-only";

/** LINE Login の ID トークンを検証し `sub`（ユーザー ID）を返す */
export async function verifyLineIdToken(
  idToken: string,
  channelId: string,
): Promise<{ sub: string }> {
  const body = new URLSearchParams({
    id_token: idToken,
    client_id: channelId,
  });

  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error("LINE token verification failed");
  }

  const json = (await res.json()) as { sub?: string };
  if (!json.sub || typeof json.sub !== "string") {
    throw new Error("LINE token response missing sub");
  }

  return { sub: json.sub };
}
