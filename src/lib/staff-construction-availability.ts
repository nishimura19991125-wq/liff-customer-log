import "server-only";

export function nfkcNormalize(s: string): string {
  return s.normalize("NFKC").trim();
}

/** @pocket のセルを検索・表示用の単一行テキストにする（選択肢オブジェクト・配列に対応） */
export function pocketTableCellToPlainString(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (Array.isArray(raw)) {
    const parts = raw
      .map((x) => pocketTableCellToPlainString(x))
      .filter((x) => x !== "");
    return parts.length ? parts.join(",") : "";
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const cand =
      o.label ?? o.name ?? o.text ?? o.value ?? o.caption ?? o.title;
    if (cand !== undefined && cand !== null) {
      return nfkcNormalize(String(cand));
    }
    return nfkcNormalize(String(raw));
  }
  if (typeof raw === "number" || typeof raw === "boolean") {
    return nfkcNormalize(String(raw));
  }
  return nfkcNormalize(String(raw));
}

/** 一覧 API の選択肢・文字列を「稼働」判定用に正規化して比較 */
export function staffConstructionAvailabilityIsActive(
  raw: unknown,
  activeLabel: string,
): boolean {
  if (raw === undefined || raw === null) return false;
  if (Array.isArray(raw)) {
    return raw.some((x) =>
      staffConstructionAvailabilityIsActive(x, activeLabel),
    );
  }
  const target = nfkcNormalize(activeLabel);
  if (typeof raw === "string") return nfkcNormalize(raw) === target;
  if (typeof raw === "number" || typeof raw === "boolean") {
    return nfkcNormalize(String(raw)) === target;
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const cand =
      o.label ?? o.name ?? o.text ?? o.value ?? o.caption ?? o.title;
    if (cand !== undefined && cand !== null) {
      return nfkcNormalize(String(cand)) === target;
    }
  }
  return nfkcNormalize(String(raw)) === target;
}
