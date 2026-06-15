/** @pocket 添付ファイルフィールドのパース（クライアント・サーバー共通） */

export type AtPocketFileEntry = {
  name: string;
  mimeType: string;
  contentBase64?: string;
  externalUrl?: string;
};

export function isImageMimeType(mime: string): boolean {
  return mime.trim().toLowerCase().startsWith("image/");
}

export function isDisplayableImageFile(entry: AtPocketFileEntry): boolean {
  if (isImageMimeType(entry.mimeType)) return true;
  const n = entry.name.trim().toLowerCase();
  return /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/.test(n);
}

/** レコードの添付ファイル列（配列 or 単体オブジェクト）を正規化 */
export function parseAtPocketFileField(raw: unknown): AtPocketFileEntry[] {
  if (raw == null) return [];
  const items = Array.isArray(raw) ? raw : [raw];
  const out: AtPocketFileEntry[] = [];

  for (const item of items) {
    if (item == null) continue;
    if (typeof item === "string") {
      const t = item.trim();
      if (t) out.push({ name: "file", mimeType: "application/octet-stream" });
      continue;
    }
    if (typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = String(o.name ?? o.fileName ?? "").trim();
    const mimeType = String(
      o.type ?? o.mimeType ?? o.contentType ?? "application/octet-stream",
    ).trim();
    const content =
      typeof o.content === "string" && o.content.trim()
        ? o.content.trim()
        : undefined;
    const externalUrl =
      (typeof o.src === "string" && o.src.trim()) ||
      (typeof o.url === "string" && o.url.trim()) ||
      (typeof o.downloadUrl === "string" && o.downloadUrl.trim()) ||
      undefined;

    if (name || content || externalUrl) {
      out.push({
        name: name || "file",
        mimeType: mimeType || "application/octet-stream",
        contentBase64: content,
        externalUrl,
      });
    }
  }

  return out;
}
