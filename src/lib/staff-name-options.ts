import { normApClStaffName } from "@/lib/customer-info-form/pt-transfer";

/** プルダウンに既存値を残す（名簿リスト外の保存値でも表示できるように） */
export function mergeStaffNameOptions(
  options: string[],
  currentValue: string | undefined,
): string[] {
  const merged = new Set(options);
  const t = normApClStaffName(currentValue);
  if (t) merged.add(t);
  return [...merged].sort((a, b) => a.localeCompare(b, "ja"));
}

/** 入力文字列に一致するスタッフ名候補（名簿のみ） */
export function filterStaffNameSuggestions(
  options: readonly string[],
  query: string,
): string[] {
  const q = normApClStaffName(query).toLowerCase();
  if (!q) return [...options];
  const ranked: string[] = [];
  for (const opt of options) {
    const n = normApClStaffName(opt).toLowerCase();
    if (!n) continue;
    if (n.startsWith(q) || n.includes(q)) ranked.push(opt);
  }
  return ranked;
}

/** 名簿上のスタッフ名と完全一致するか（候補未取得時は true） */
export function isExactStaffName(
  options: readonly string[],
  raw: string | undefined,
): boolean {
  const t = normApClStaffName(raw);
  if (!t) return true;
  if (options.length === 0) return true;
  return options.some((o) => normApClStaffName(o) === t);
}

/**
 * 入力を名簿の正式名に確定する。
 * 完全一致 → その名前 / 不一致なら先頭候補 / 候補なし → 空
 */
export function commitStaffNameInput(
  options: readonly string[],
  raw: string | undefined,
): string {
  const t = normApClStaffName(raw);
  if (!t) return "";
  if (options.length === 0) return t;
  const exact = options.find((o) => normApClStaffName(o) === t);
  if (exact) return exact;
  const top = filterStaffNameSuggestions(options, t)[0];
  return top ?? "";
}
