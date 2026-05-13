import "server-only";

/** LINE の verify が IdToken 期限切れを返したとき */
export class LineIdTokenExpiredError extends Error {
  constructor() {
    super("LINE IdToken expired");
    this.name = "LineIdTokenExpiredError";
  }
}

function lineVerifyResponseLooksExpired(bodyText: string): boolean {
  try {
    const j = JSON.parse(bodyText) as { error_description?: string };
    return /expired/i.test(String(j.error_description ?? ""));
  } catch {
    return false;
  }
}

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
    const text = await res.text();
    console.error("[line-verify] LINE verify failed:", res.status, text);
    if (lineVerifyResponseLooksExpired(text)) {
      throw new LineIdTokenExpiredError();
    }
    throw new Error(`LINE token verification failed (${res.status})`);
  }

  const json = (await res.json()) as { sub?: string };
  if (!json.sub || typeof json.sub !== "string") {
    throw new Error("LINE token response missing sub");
  }

  return { sub: json.sub };
}
