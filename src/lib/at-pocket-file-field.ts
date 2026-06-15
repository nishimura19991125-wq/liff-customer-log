/** @pocket 添付ファイルフィールドのパース（クライアント・サーバー共通） */

export type AtPocketFileEntry = {
  name: string;
  mimeType: string;
  contentBase64?: string;
  externalUrl?: string;
};

function decodeDataUrl(
  raw: string,
): { mimeType: string; contentBase64: string } | null {
  const t = raw.trim();
  const m = /^data:([^;,]+)?(?:;charset=[^;,]+)?(?:;base64)?,([\s\S]+)$/i.exec(t);
  if (!m) return null;
  return {
    mimeType: (m[1] ?? "application/octet-stream").trim(),
    contentBase64: m[2] ?? "",
  };
}

function guessMimeFromName(name: string): string {
  const n = name.trim().toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".bmp")) return "image/bmp";
  if (n.endsWith(".svg")) return "image/svg+xml";
  if (/\.jpe?g$/.test(n)) return "image/jpeg";
  return "application/octet-stream";
}

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
  if (typeof raw === "object" && !Array.isArray(raw) && "value" in raw) {
    return parseAtPocketFileField((raw as Record<string, unknown>).value);
  }
  const items = Array.isArray(raw) ? raw : [raw];
  const out: AtPocketFileEntry[] = [];

  for (const item of items) {
    if (item == null) continue;
    if (typeof item === "string") {
      const t = item.trim();
      if (!t) continue;
      const dataUrl = decodeDataUrl(t);
      if (dataUrl) {
        out.push({
          name: "file",
          mimeType: dataUrl.mimeType,
          contentBase64: dataUrl.contentBase64,
        });
        continue;
      }
      if (/^https?:\/\//i.test(t) || t.startsWith("/")) {
        out.push({ name: "file", mimeType: "application/octet-stream", externalUrl: t });
      }
      continue;
    }
    if (typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = String(o.name ?? o.fileName ?? o.filename ?? "").trim();
    let mimeType = String(
      o.type ?? o.mimeType ?? o.contentType ?? "",
    ).trim();
    let content =
      typeof o.content === "string" && o.content.trim()
        ? o.content.trim()
        : undefined;
    if (content?.startsWith("data:")) {
      const dataUrl = decodeDataUrl(content);
      if (dataUrl) {
        mimeType = mimeType || dataUrl.mimeType;
        content = dataUrl.contentBase64;
      }
    }
    const externalUrl =
      (typeof o.src === "string" && o.src.trim()) ||
      (typeof o.url === "string" && o.url.trim()) ||
      (typeof o.downloadUrl === "string" && o.downloadUrl.trim()) ||
      (typeof o.path === "string" && o.path.trim()) ||
      (typeof o.href === "string" && o.href.trim()) ||
      undefined;

    if (!mimeType && name) mimeType = guessMimeFromName(name);
    if (!mimeType) mimeType = "application/octet-stream";

    if (name || content || externalUrl) {
      out.push({
        name: name || "file",
        mimeType,
        contentBase64: content,
        externalUrl,
      });
    }
  }

  return out;
}

export function atPocketFileHasPayload(file: AtPocketFileEntry): boolean {
  return Boolean(
    file.contentBase64?.trim() ||
      file.externalUrl?.trim() ||
      file.name.trim(),
  );
}
