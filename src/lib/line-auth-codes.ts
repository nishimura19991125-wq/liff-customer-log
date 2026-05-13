/** API が 401 で返すときの code（クライアントとサーバーで共有） */
export const LINE_SESSION_EXPIRED_CODE = "LINE_SESSION_EXPIRED" as const;

export function isLineSessionExpiredPayload(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { code?: string }).code === LINE_SESSION_EXPIRED_CODE
  );
}
