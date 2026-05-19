/**
 * @pocket の CheckBox / MultiSelect は選択肢見出しの配列
 * @see https://developers.at-pocket.com/js-api/notes/field-type-list/
 */

/** LIFF フォーム値（カンマ区切り）→ @pocket PUT 用の配列 */
export function checkboxGroupValueToPocketArray(
  formValue: string,
  allowedOptions?: readonly string[],
): string[] {
  const selected = formValue
    .split(/[,、\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowedOptions?.length) return selected;
  const allowed = new Set(allowedOptions);
  return selected.filter((s) => allowed.has(s));
}

/** @pocket GET の値 → LIFF フォーム（カンマ区切り） */
export function checkboxGroupValueFromPocket(raw: unknown): string {
  if (raw == null) return "";
  if (Array.isArray(raw)) {
    const parts: string[] = [];
    for (const item of raw) {
      if (typeof item === "string") {
        const t = item.trim();
        if (t) parts.push(t);
        continue;
      }
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        for (const k of ["value", "label", "name", "displayValue", "text"]) {
          const v = o[k];
          if (typeof v === "string" && v.trim()) {
            parts.push(v.trim());
            break;
          }
        }
      }
    }
    return parts.join(",");
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return "";
    if (t.startsWith("[") && t.endsWith("]")) {
      try {
        const parsed = JSON.parse(t) as unknown;
        if (Array.isArray(parsed)) {
          return checkboxGroupValueFromPocket(parsed);
        }
      } catch {
        /* 通常の文字列として続行 */
      }
    }
    return t
      .split(/[,、\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(",");
  }
  return String(raw).trim();
}
