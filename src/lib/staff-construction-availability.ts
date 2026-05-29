import "server-only";

/** @pocket のセル値を比較用のプレーン文字列に寄せる */
export function pocketTableCellToPlainString(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw).trim();
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const value = o.value;
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value).trim();
    }
    const label = o.label;
    if (typeof label === "string") return label.trim();
    const text = o.text;
    if (typeof text === "string") return text.trim();
    const displayValue = o.displayValue;
    if (typeof displayValue === "string") return displayValue.trim();
    const caption = o.caption;
    if (typeof caption === "string") return caption.trim();
  }
  return String(raw).trim();
}

export function nfkcNormalize(input: string): string {
  return input.normalize("NFKC").trim();
}

/** 工事対応稼働状況が activeLabel と一致するとき true（NFKC 正規化・前後空白除去） */
export function staffConstructionAvailabilityIsActive(
  rawStatus: unknown,
  activeLabel: string,
): boolean {
  const want = nfkcNormalize(activeLabel || "稼働");
  const cell = pocketTableCellToPlainString(rawStatus);
  if (!cell) return false;
  return nfkcNormalize(cell) === want;
}
